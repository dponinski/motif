// Who may sign in. The list is of verified email addresses: `alice@example.com` for one person, `@example.com` for
// everyone at a domain. A person is allowed when an address of theirs is on it. An empty list allows nobody, so a
// server that hasn't been told who may sign in doesn't let just anyone spend what it pays for.

export const EMAIL = /^[^\s@,;<>()[\]\\"]{1,64}@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

// The address as it is compared: lower case, no padding. Null when it isn't an email address.
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function isAllowed(email: string | null | undefined, allowed: string[]): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  const domain = e.slice(e.lastIndexOf("@"));
  return allowed.some((entry) => entry === e || (entry.startsWith("@") && entry === domain));
}

// The first of a person's verified addresses that is on the list.
export function allowedEmail(emails: { email: string; verified: boolean }[], allowed: string[]): string | null {
  for (const { email, verified } of emails) {
    const e = normalizeEmail(email);
    if (verified && e && isAllowed(e, allowed)) return e;
  }
  return null;
}
