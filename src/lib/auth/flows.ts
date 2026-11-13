import { NextRequest, NextResponse } from "next/server";
import { allowedEmail, isAllowed, normalizeEmail } from "./allowlist";
import type { Provider } from "./config";
import { FLOW_COOKIE, clearSessionCookie, clientIp, cookieOptions, isSecure, limited, originOf, sanitizeReturnTo, setSessionCookie, type Auth } from "./http";
import { OidcError, appleClientSecret, authorizeUrl, discover, exchangeCode, pkce, randomString, verifyIdToken } from "./oidc";
import { completeSignIn, type Claim, type SignInResult } from "./signin";
import { createSession } from "./store";

// The routes of signing in, written once: what is the same for Google and Apple, and what to do with the answer.

// What the person is told when a sign-in doesn't end with them signed in: a short reason in the address of the page
// they come back to, which the page turns into words (store/auth.ts).
export type AuthError = "denied" | "state" | "failed" | "unavailable" | "not-allowed" | "no-verified-email" | "private-email" | "rate" | "github-email";

const MINUTE = 60_000;

export const errorFor = (result: Exclude<SignInResult, { ok: true }>, provider: Provider): AuthError =>
  result.reason === "no-verified-email" && provider === "github" ? "github-email" : result.reason;

export function back(req: NextRequest, auth: Auth, returnTo: string, error?: AuthError, status = 307): NextResponse {
  const url = new URL(returnTo, originOf(req, auth.config));
  if (error) url.searchParams.set("auth_error", error);
  const res = NextResponse.redirect(url, status);
  res.cookies.set(FLOW_COOKIE, "", cookieOptions(isSecure(req, auth.config), 0, { path: "/api/auth" }));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

// Lets the person in: a session, in a cookie, and on to where they were.
export async function signedIn(req: NextRequest, auth: Auth, userId: string, returnTo: string, status = 307, extra?: (res: NextResponse) => void): Promise<NextResponse> {
  const { token, expiresAt } = await createSession(auth.db, userId, req.headers.get("user-agent"));
  const res = back(req, auth, returnTo, undefined, status);
  setSessionCookie(res, token, expiresAt, isSecure(req, auth.config));
  extra?.(res);
  return res;
}

// ── OpenID Connect: Google and Apple ──────────────────────────────────────────

interface Flow { p: string; s: string; n: string; v: string; to: string }

const encodeFlow = (f: Flow) => Buffer.from(JSON.stringify(f)).toString("base64url");
function decodeFlow(text: string | undefined): Flow | null {
  if (!text) return null;
  try {
    const f = JSON.parse(Buffer.from(text, "base64url").toString()) as Partial<Flow>;
    return typeof f.p === "string" && typeof f.s === "string" && typeof f.n === "string" && typeof f.v === "string" && typeof f.to === "string" ? (f as Flow) : null;
  } catch {
    return null;
  }
}

// Apple answers with a form posted from its own site, and a cookie is only sent along with that when it is
// `SameSite=None` (and so `Secure`). Google answers with a plain redirect, which `Lax` is enough for.
const flowCookie = (provider: "google" | "apple", secure: boolean) =>
  provider === "apple" ? cookieOptions(true, 600, { path: "/api/auth", sameSite: "none" }) : cookieOptions(secure, 600, { path: "/api/auth" });

export async function startOidc(req: NextRequest, auth: Auth, provider: "google" | "apple"): Promise<NextResponse> {
  const returnTo = sanitizeReturnTo(req.nextUrl.searchParams.get("returnTo"));
  const attempts = await limited(auth, `signin:${clientIp(req)}`, 60, 10 * MINUTE);
  if (!attempts.ok) return back(req, auth, returnTo, "rate");
  const cfg = auth.config[provider]!;
  const state = randomString();
  const nonce = randomString();
  const { verifier, challenge } = pkce();
  let target: string;
  try {
    const d = await discover(cfg.issuer);
    const redirect_uri = `${originOf(req, auth.config)}/api/auth/${provider}/callback`;
    target = authorizeUrl(d, provider === "google"
      ? { client_id: cfg.clientId, redirect_uri, response_type: "code", scope: "openid email profile", state, nonce, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" }
      : { client_id: cfg.clientId, redirect_uri, response_type: "code", response_mode: "form_post", scope: "name email", state, nonce });
  } catch (err) {
    console.error(`${provider} sign-in couldn't start:`, err instanceof Error ? err.message : "unexpected error");
    return back(req, auth, returnTo, "unavailable");
  }
  const res = NextResponse.redirect(target);
  res.cookies.set(FLOW_COOKIE, encodeFlow({ p: provider, s: state, n: nonce, v: verifier, to: returnTo }), flowCookie(provider, isSecure(req, auth.config)));
  res.headers.set("Cache-Control", "no-store");
  return res;
}

const truthy = (v: unknown) => v === true || v === "true";

export async function finishOidc(
  req: NextRequest,
  auth: Auth,
  provider: "google" | "apple",
  params: { code: string | null; state: string | null; error: string | null; user?: string | null }
): Promise<NextResponse> {
  const flow = decodeFlow(req.cookies.get(FLOW_COOKIE)?.value);
  // A sign-in that wasn't started in this browser, for this provider, is not finished.
  if (!flow || flow.p !== provider || flow.s !== params.state) return back(req, auth, "/", "state", provider === "apple" ? 303 : 307);
  const status = provider === "apple" ? 303 : 307;
  const returnTo = sanitizeReturnTo(flow.to);
  if (params.error) return back(req, auth, returnTo, params.error === "access_denied" || params.error === "user_cancelled_authorize" ? "denied" : "failed", status);
  if (!params.code) return back(req, auth, returnTo, "failed", status);

  const cfg = auth.config[provider]!;
  try {
    const d = await discover(cfg.issuer);
    const redirect_uri = `${originOf(req, auth.config)}/api/auth/${provider}/callback`;
    const form: Record<string, string> = { grant_type: "authorization_code", code: params.code, redirect_uri, client_id: cfg.clientId };
    if (provider === "google") {
      form.client_secret = auth.config.google!.clientSecret;
      form.code_verifier = flow.v;
    } else {
      form.client_secret = await appleClientSecret(auth.config.apple!, auth.config.apple!.issuer);
    }
    const tokens = await exchangeCode(d, form);
    const claims = await verifyIdToken(tokens.id_token, d, {
      audience: cfg.clientId,
      nonce: flow.n,
      issuers: provider === "google" ? [d.issuer, "accounts.google.com", "https://accounts.google.com"] : undefined,
    });

    // Apple tells the person's name once, in the form that is posted, not in the token.
    let name = typeof claims.name === "string" ? claims.name : null;
    if (provider === "apple" && params.user) {
      try {
        const u = JSON.parse(params.user) as { name?: { firstName?: string; lastName?: string } };
        name = [u.name?.firstName, u.name?.lastName].filter(Boolean).join(" ") || null;
      } catch { /* the name is only for show */ }
    }
    const email = typeof claims.email === "string" ? claims.email : null;
    const claim: Claim = {
      provider,
      subject: String(claims.sub),
      emails: email ? [{ email, verified: truthy(claims.email_verified) }] : [],
      name,
      avatar: typeof claims.picture === "string" && claims.picture.startsWith("https://") ? claims.picture : null,
    };
    const result = await completeSignIn(auth.db, auth.config.allowed, claim);
    if (!result.ok) return back(req, auth, returnTo, errorFor(result, provider), status);
    return signedIn(req, auth, result.user.id, returnTo, status);
  } catch (err) {
    // What the provider said, never the code or a token.
    console.error(`${provider} sign-in failed:`, err instanceof OidcError ? err.code : "unexpected error");
    return back(req, auth, returnTo, err instanceof OidcError && err.code === "unavailable" ? "unavailable" : "failed", status);
  }
}

export { allowedEmail, isAllowed, normalizeEmail, clearSessionCookie };
