import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitHubClient } from "../lib/github";
import { NOTICES, appTokenSource, takeSignInError, useAccount } from "./account";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const session = (token: string, extra: Record<string, unknown> = {}) => reply({ configured: true, signedIn: true, accessToken: token, expiresAt: Date.now() + 8 * 3600_000, installUrl: "https://github.com/apps/motif/installations/new", ...extra });

let calls: string[];
let handler: (url: string, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  handler = () => reply({ configured: false, signedIn: false });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push(url); return handler(url, init); }));
  useAccount.setState({ status: "unknown", login: null, avatar: null, installUrl: null, accessToken: null, expiresAt: null, ended: null, notice: null });
});
afterEach(() => vi.unstubAllGlobals());

describe("who is signed in", () => {
  it("is nobody, and nothing is offered, when the server has no app", async () => {
    await useAccount.getState().load();
    expect(useAccount.getState()).toMatchObject({ status: "unavailable", accessToken: null });
    expect(await appTokenSource.get()).toBeNull();
  });

  it("is nothing offered when there is no server to ask", async () => {
    handler = () => { throw new TypeError("Failed to fetch"); };
    await useAccount.getState().load();
    expect(useAccount.getState().status).toBe("unavailable");
  });

  it("is signed out, with the link to install the app, when there is no cookie", async () => {
    handler = () => reply({ configured: true, signedIn: false, installUrl: "https://github.com/apps/motif/installations/new" });
    await useAccount.getState().load();
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", installUrl: "https://github.com/apps/motif/installations/new", ended: null });
  });

  it("is signed in with a token, and finds out the name", async () => {
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_1") : reply({ login: "ada", avatar_url: "https://avatars.githubusercontent.com/u/1" }));
    await useAccount.getState().load();
    expect(useAccount.getState()).toMatchObject({ status: "signed-in", accessToken: "ghu_1", login: "ada", avatar: "https://avatars.githubusercontent.com/u/1" });
    expect(calls).toEqual(["/api/github/session", "https://api.github.com/user"]);
  });

  it("is signed in even when the name can't be had", async () => {
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_1") : reply({ message: "Bad credentials" }, 401));
    await useAccount.getState().load();
    expect(useAccount.getState()).toMatchObject({ status: "signed-in", login: null });
  });

  it("says when a sign-in ended by itself", async () => {
    handler = () => reply({ configured: true, signedIn: false, reason: "expired" });
    await useAccount.getState().load();
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", ended: "expired" });
  });

  it("stays as it was when GitHub couldn't be reached", async () => {
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_1") : reply({ login: "ada" }));
    await useAccount.getState().load();
    handler = () => reply({ error: "GitHub could not be reached" }, 502);
    await useAccount.getState().load(true);
    expect(useAccount.getState()).toMatchObject({ status: "signed-in", accessToken: "ghu_1" });
  });

  it("asks once for two who ask together", async () => {
    handler = async () => { await new Promise((r) => setTimeout(r, 10)); return reply({ configured: true, signedIn: false }); };
    await Promise.all([useAccount.getState().load(), useAccount.getState().load()]);
    expect(calls).toEqual(["/api/github/session"]);
  });

  it("signs out: the server is told, and nothing is kept", async () => {
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_1") : reply({ login: "ada" }));
    await useAccount.getState().load();
    handler = () => reply({ ok: true });
    await useAccount.getState().signOut();
    expect(calls.at(-1)).toBe("/api/github/logout");
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1]).toMatchObject({ method: "POST", headers: { "x-requested-with": "motif" } });
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", accessToken: null, login: null });
  });
});

describe("the token a request uses", () => {
  beforeEach(() => {
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_1") : reply({ login: "ada" }));
  });

  it("is asked for the first time it is wanted", async () => {
    expect(await appTokenSource.get()).toBe("ghu_1");
    expect(calls.filter((c) => c.startsWith("/api/github/session"))).toHaveLength(1);
    expect(await appTokenSource.get()).toBe("ghu_1");
    expect(calls.filter((c) => c.startsWith("/api/github/session"))).toHaveLength(1);
  });

  it("is renewed when it is about to stop working", async () => {
    await appTokenSource.get();
    useAccount.setState({ expiresAt: Date.now() + 30_000 });
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_2") : reply({ login: "ada" }));
    expect(await appTokenSource.get()).toBe("ghu_2");
  });

  it("is renewed when GitHub refused it, whatever it says about itself", async () => {
    await appTokenSource.get();
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_2") : reply({ login: "ada" }));
    expect(await appTokenSource.get("ghu_1")).toBe("ghu_2");
    expect(calls.filter((c) => c.includes("force=1"))).toHaveLength(1);
  });

  it("is renewed once when several requests are refused the same token together, and not again for a late one", async () => {
    await appTokenSource.get();
    handler = async (url) => { if (url.includes("force=1")) await new Promise((r) => setTimeout(r, 10)); return url.startsWith("/api/github/session") ? session("ghu_2") : reply({ login: "ada" }); };
    const got = await Promise.all([appTokenSource.get("ghu_1"), appTokenSource.get("ghu_1"), appTokenSource.get("ghu_1")]);
    expect(got).toEqual(["ghu_2", "ghu_2", "ghu_2"]);
    // A request that was refused ghu_1 before the renewal and is only now asking is given the token that replaced it.
    expect(await appTokenSource.get("ghu_1")).toBe("ghu_2");
    expect(calls.filter((c) => c.includes("force=1"))).toHaveLength(1);
  });

  it("renews again when the token that replaced it is refused too", async () => {
    await appTokenSource.get();
    handler = (url) => (url.startsWith("/api/github/session") ? session("ghu_3") : reply({ login: "ada" }));
    expect(await appTokenSource.get("ghu_1")).toBe("ghu_3");
    expect(await appTokenSource.get("ghu_3")).toBe("ghu_3");
    expect(calls.filter((c) => c.includes("force=1"))).toHaveLength(2);
  });

  it("is nothing when the renewal shows the sign-in is over", async () => {
    await appTokenSource.get();
    handler = () => reply({ configured: true, signedIn: false, reason: "expired" });
    expect(await appTokenSource.get("ghu_1")).toBeNull();
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", ended: "expired" });
  });
});

describe("the client with the account's token", () => {
  const github = (responses: Response[], seen: { auth: string | null }[]) => {
    const queue = [...responses];
    return vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/github/session")) return url.includes("force=1") ? session("ghu_new") : session("ghu_old");
      if (url === "https://api.github.com/user") return reply({ login: "ada" });
      seen.push({ auth: new Headers(init?.headers).get("Authorization") });
      return queue.shift() ?? reply({}, 500);
    });
  };

  it("uses the account's token when none was typed in", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({ default_branch: "main", permissions: { push: true } })], seen));
    const out = await createGitHubClient({ owner: "a", repo: "b", token: "", source: appTokenSource }).getRepo();
    expect(out).toEqual({ defaultBranch: "main", canPush: true });
    expect(seen).toEqual([{ auth: "Bearer ghu_old" }]);
  });

  it("prefers a token that was typed in", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({ default_branch: "main" })], seen));
    await createGitHubClient({ owner: "a", repo: "b", token: "github_pat_x", source: appTokenSource }).getRepo();
    expect(seen).toEqual([{ auth: "Bearer github_pat_x" }]);
  });

  it("renews the token once when GitHub refuses it, and makes the request again", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({ message: "Bad credentials" }, 401), reply({ default_branch: "main" })], seen));
    await createGitHubClient({ owner: "a", repo: "b", token: "", source: appTokenSource }).getRepo();
    expect(seen).toEqual([{ auth: "Bearer ghu_old" }, { auth: "Bearer ghu_new" }]);
  });

  it("says the sign-in has expired when the renewed token is refused as well", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({}, 401), reply({}, 401)], seen));
    await expect(createGitHubClient({ owner: "a", repo: "b", token: "", source: appTokenSource }).getRepo()).rejects.toThrow("Your GitHub sign-in has expired. Sign in again.");
    expect(seen).toHaveLength(2);
  });

  it("doesn't renew a token that was typed in, which GitHub refused", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({}, 401)], seen));
    await expect(createGitHubClient({ owner: "a", repo: "b", token: "github_pat_x", source: appTokenSource }).getRepo()).rejects.toThrow("GitHub rejected the token");
    expect(seen).toHaveLength(1);
  });

  it("reads like a visitor when nobody is signed in", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.startsWith("/api/github/session")) return reply({ configured: true, signedIn: false });
      return new Response("export const x = 1;", { status: 200 });
    }));
    const text = await createGitHubClient({ owner: "a", repo: "b", token: "", source: appTokenSource }).readText("src/x.ts", "main");
    expect(text).toBe("export const x = 1;");
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0]).toContain("raw.githubusercontent.com");
  });

  it("says the app isn't installed when a repository isn't found with the account's token", async () => {
    const seen: { auth: string | null }[] = [];
    vi.stubGlobal("fetch", github([reply({ message: "Not Found" }, 404)], seen));
    await expect(createGitHubClient({ owner: "a", repo: "b", token: "", source: appTokenSource }).getRepo()).rejects.toThrow("the Motif GitHub App isn't installed on it");
  });
});

describe("a sign-in that didn't finish", () => {
  it("is shown once, and taken out of the address", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: { href: "https://motif.example/editor/abc?github_error=denied&x=1#top", pathname: "/editor/abc" }, history: { replaceState } });
    takeSignInError();
    expect(useAccount.getState().notice).toBe(NOTICES.denied);
    expect(replaceState).toHaveBeenCalledWith(null, "", "/editor/abc?x=1#top");
  });

  it("is a general message for a reason that isn't known, and nothing for no reason", () => {
    vi.stubGlobal("window", { location: { href: "https://motif.example/?github_error=banana", pathname: "/" }, history: { replaceState: vi.fn() } });
    takeSignInError();
    expect(useAccount.getState().notice).toBe(NOTICES.failed);
    useAccount.setState({ notice: null });
    vi.stubGlobal("window", { location: { href: "https://motif.example/", pathname: "/" }, history: { replaceState: vi.fn() } });
    takeSignInError();
    expect(useAccount.getState().notice).toBeNull();
  });
});
