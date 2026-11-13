import type { OAuthConfig } from "../github-oauth";
import type { Db } from "./db";
import { completeSignIn, type SignInResult } from "./signin";

// Signing in to Motif with GitHub: the access token the GitHub App sign-in just got is used to ask GitHub who this is
// and which email addresses of theirs it has verified. (The app needs "Email addresses: read" among its account
// permissions for that; without it there are no verified addresses to go by and the person is told so.)

type Fetch = typeof fetch;

async function get<T>(config: OAuthConfig, access: string, path: string, fetchImpl: Fetch): Promise<T | null> {
  try {
    const res = await fetchImpl(`${config.apiUrl}${path}`, {
      cache: "no-store",
      headers: { Authorization: `Bearer ${access}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

export async function githubLogin(db: Db, allowed: string[], config: OAuthConfig, access: string, fetchImpl: Fetch = fetch): Promise<SignInResult> {
  const user = await get<{ id?: number; name?: string | null; login?: string; avatar_url?: string }>(config, access, "/user", fetchImpl);
  if (!user || typeof user.id !== "number") return { ok: false, reason: "no-verified-email" };
  const emails = (await get<{ email?: string; verified?: boolean }[]>(config, access, "/user/emails", fetchImpl)) ?? [];
  return completeSignIn(db, allowed, {
    provider: "github",
    subject: String(user.id),
    emails: emails.filter((e) => typeof e.email === "string").map((e) => ({ email: e.email!, verified: e.verified === true })),
    name: user.name || user.login || null,
    avatar: typeof user.avatar_url === "string" && user.avatar_url.startsWith("https://") ? user.avatar_url : null,
  });
}
