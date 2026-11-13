// What the server has been told about accounts: where to keep them, how people can sign in, and who may. Nothing is
// offered that isn't set up; a server without a database has no accounts and works as it did before.

export interface AuthConfig {
  // mysql://user:password@host:3306/database
  databaseUrl: string;
  // Where this site is served, for the addresses the providers send people back to.
  appUrl: string | null;
  // Who may sign in, by verified email: exact addresses and `@domain` entries. Empty means nobody (fail closed).
  allowed: string[];
  email: { smtpUrl: string; from: string } | null;
  google: { clientId: string; clientSecret: string; issuer: string } | null;
  apple: { clientId: string; teamId: string; keyId: string; privateKey: string; issuer: string } | null;
  // How many chat messages one person may send per hour; 0 means no limit.
  chatPerHour: number;
}

type Env = Record<string, string | undefined>;

const clean = (v: string | undefined) => v?.trim() || undefined;
const trimSlash = (url: string) => url.replace(/\/+$/, "");

export function parseAllowed(text: string | undefined): string[] {
  return [...new Set((text ?? "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase().replace(/^\*(?=@)/, "")).filter(Boolean))];
}

// Null unless there is a database: accounts are kept in it.
export function readAuthConfig(env: Env = process.env): AuthConfig | null {
  const databaseUrl = clean(env.DATABASE_URL);
  if (!databaseUrl) return null;

  const smtpUrl = clean(env.SMTP_URL);
  const googleId = clean(env.GOOGLE_CLIENT_ID);
  const googleSecret = clean(env.GOOGLE_CLIENT_SECRET);
  const appleId = clean(env.APPLE_CLIENT_ID);
  const appleTeam = clean(env.APPLE_TEAM_ID);
  const appleKeyId = clean(env.APPLE_KEY_ID);
  // A key kept in an environment variable has its line breaks written as \n.
  const applePrivateKey = clean(env.APPLE_PRIVATE_KEY)?.replace(/\\n/g, "\n");

  return {
    databaseUrl,
    appUrl: clean(env.APP_URL) ? trimSlash(clean(env.APP_URL)!) : null,
    allowed: parseAllowed(env.ALLOWED_EMAILS),
    email: smtpUrl ? { smtpUrl, from: clean(env.MAIL_FROM) ?? "Motif <no-reply@localhost>" } : null,
    google: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret, issuer: trimSlash(clean(env.GOOGLE_ISSUER) ?? "https://accounts.google.com") } : null,
    apple: appleId && appleTeam && appleKeyId && applePrivateKey
      ? { clientId: appleId, teamId: appleTeam, keyId: appleKeyId, privateKey: applePrivateKey, issuer: trimSlash(clean(env.APPLE_ISSUER) ?? "https://appleid.apple.com") }
      : null,
    chatPerHour: Math.max(0, Number.parseInt(env.CHAT_PER_HOUR ?? "", 10) || 60),
  };
}

export type Provider = "github" | "google" | "apple" | "email";

// The ways to sign in that this server offers. GitHub is the GitHub App of the repository sign-in, so it is there
// when that is set up.
export function providersOf(config: AuthConfig, github: boolean): Record<Provider, boolean> {
  return { github, google: !!config.google, apple: !!config.apple, email: !!config.email };
}
