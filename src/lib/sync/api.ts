// Talking to this app's own server about accounts, projects and teams. Shared by the stores that do it.

export class SignedOut extends Error {}
export class Unreachable extends Error {}

export type Reply<T> = { status: number; body: T & { error?: string; conflict?: boolean; limit?: boolean; forbidden?: boolean; reason?: string; current?: unknown } };

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<Reply<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { "x-requested-with": "motif", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(30_000) : undefined,
    });
  } catch {
    throw new Unreachable();
  }
  if (res.status === 401) throw new SignedOut();
  // A server that is down or restarting is "offline" too.
  if (res.status >= 500) throw new Unreachable();
  return { status: res.status, body: ((await res.json().catch(() => ({}))) as Reply<T>["body"]) };
}
