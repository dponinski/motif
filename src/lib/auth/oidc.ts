import { SignJWT, createRemoteJWKSet, importPKCS8, jwtVerify, type JWTPayload } from "jose";
import { createHash, randomBytes } from "node:crypto";

// Signing in with Google and Apple: the OpenID Connect authorization code flow. The browser is sent to the provider
// with a state (so the way back is known to be one this browser started), a nonce (so the token that comes back
// is for this sign-in) and for Google a PKCE challenge; the code that comes back is exchanged here, with the app's
// secret, and the ID token that answers is checked against the provider's published keys.

type Fetch = typeof fetch;

export interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

const discoveries = new Map<string, { at: number; value: Discovery }>();
const HOUR = 3_600_000;

// The provider's own description of where its endpoints and keys are, kept for an hour.
export async function discover(issuer: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<Discovery> {
  const cached = discoveries.get(issuer);
  if (cached && now - cached.at < HOUR) return cached.value;
  const res = await fetchImpl(`${issuer}/.well-known/openid-configuration`, { cache: "no-store" });
  if (!res.ok) throw new Error(`${issuer} didn't describe itself (${res.status})`);
  const body = (await res.json()) as Partial<Discovery>;
  if (!body.authorization_endpoint || !body.token_endpoint || !body.jwks_uri || !body.issuer) throw new Error(`${issuer} gave an incomplete description`);
  const value: Discovery = { issuer: body.issuer, authorization_endpoint: body.authorization_endpoint, token_endpoint: body.token_endpoint, jwks_uri: body.jwks_uri };
  discoveries.set(issuer, { at: now, value });
  return value;
}

export const forgetDiscoveries = () => discoveries.clear();

const b64url = (buf: Buffer) => buf.toString("base64url");
export const randomString = (bytes = 24) => b64url(randomBytes(bytes));

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomString(48);
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
}

export function authorizeUrl(d: Discovery, params: Record<string, string>): string {
  const url = new URL(d.authorization_endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export interface Tokens { id_token: string }

export async function exchangeCode(d: Discovery, form: Record<string, string>, fetchImpl: Fetch = fetch): Promise<Tokens> {
  let res: Response;
  try {
    res = await fetchImpl(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form),
      cache: "no-store",
    });
  } catch {
    throw new OidcError("unavailable", "The provider could not be reached");
  }
  const body = (await res.json().catch(() => null)) as { id_token?: string; error?: string } | null;
  if (res.status >= 500) throw new OidcError("unavailable", `The provider answered ${res.status}`);
  if (!res.ok || !body?.id_token) throw new OidcError(body?.error ?? "bad_response", "The provider did not give a token");
  return { id_token: body.id_token };
}

export class OidcError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const jwksets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
const keysFor = (uri: string) => {
  let set = jwksets.get(uri);
  if (!set) { set = createRemoteJWKSet(new URL(uri)); jwksets.set(uri, set); }
  return set;
};
export const forgetKeys = () => jwksets.clear();

// An ID token is believed only when it is signed with one of the provider's keys, is from the provider, is for this
// app, hasn't expired, and carries the nonce this sign-in started with.
export async function verifyIdToken(idToken: string, d: Discovery, options: { audience: string; nonce: string; issuers?: string[] }): Promise<JWTPayload & { nonce?: string }> {
  let payload: JWTPayload & { nonce?: string };
  try {
    ({ payload } = await jwtVerify(idToken, keysFor(d.jwks_uri), { issuer: options.issuers ?? [d.issuer], audience: options.audience, clockTolerance: 30 }));
  } catch (err) {
    throw new OidcError("bad_token", err instanceof Error ? err.message : "The token is not valid");
  }
  if (!payload.nonce || payload.nonce !== options.nonce) throw new OidcError("bad_nonce", "The token is not for this sign-in");
  if (typeof payload.sub !== "string" || !payload.sub) throw new OidcError("bad_token", "The token has no subject");
  return payload;
}

// Apple wants the app's secret as a short-lived token signed with the key made for it.
export async function appleClientSecret(app: { clientId: string; teamId: string; keyId: string; privateKey: string }, issuer: string, now = Date.now()): Promise<string> {
  const key = await importPKCS8(app.privateKey, "ES256");
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: app.keyId })
    .setIssuer(app.teamId)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + 300)
    .setAudience(issuer)
    .setSubject(app.clientId)
    .sign(key);
}
