import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAccount } from "./account";
import { useAIStore } from "./ai";
import { AUTH_NOTICES, signInUrl, useAuth } from "./auth";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls: { url: string; init?: RequestInit }[];
let handler: (url: string, init?: RequestInit) => Response | Promise<Response>;

beforeEach(() => {
  calls = [];
  handler = () => reply({ configured: false });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => { calls.push({ url, init }); return handler(url, init); }));
  useAuth.setState({ status: "unknown", user: null, dialog: false, nobodyAllowed: false });
  useAIStore.getState().clearMessages();
});
afterEach(() => vi.unstubAllGlobals());

describe("who is signed in to Motif", () => {
  it("is nobody, with nothing offered, when the server has no accounts", async () => {
    await useAuth.getState().load();
    expect(useAuth.getState()).toMatchObject({ status: "unavailable", user: null });
  });

  it("is nothing offered when there is no server", async () => {
    handler = () => { throw new TypeError("Failed to fetch"); };
    await useAuth.getState().load();
    expect(useAuth.getState().status).toBe("unavailable");
  });

  it("knows the ways in and the person, and asks as the app", async () => {
    handler = () => reply({ configured: true, providers: { github: true, google: true, apple: false, email: true }, nobodyAllowed: false, user: { id: "u1", email: "ada@example.com", name: "Ada", avatar: null } });
    await useAuth.getState().load();
    expect(useAuth.getState()).toMatchObject({ status: "ready", providers: { google: true, apple: false }, user: { email: "ada@example.com" } });
    expect((calls[0].init?.headers as Record<string, string>)["x-requested-with"]).toBe("motif");
  });

  it("says when nobody is allowed yet", async () => {
    handler = () => reply({ configured: true, providers: { github: false, google: false, apple: false, email: true }, nobodyAllowed: true, user: null });
    await useAuth.getState().load();
    expect(useAuth.getState().nobodyAllowed).toBe(true);
  });

  it("asks once when asked twice at the same time", async () => {
    await Promise.all([useAuth.getState().load(), useAuth.getState().load()]);
    expect(calls).toHaveLength(1);
  });

  it("signs out here and on the server, and takes the GitHub sign-in with it", async () => {
    useAuth.setState({ status: "ready", user: { id: "u1", email: "a@b.c", name: null, avatar: null } });
    useAccount.setState({ status: "signed-in", accessToken: "ghu_1", login: "ada" });
    handler = () => reply({ ok: true });
    await useAuth.getState().signOut();
    expect(calls[0]).toMatchObject({ url: "/api/auth/logout", init: { method: "POST" } });
    expect(useAuth.getState().user).toBeNull();
    expect(useAccount.getState()).toMatchObject({ status: "signed-out", accessToken: null, login: null });
  });

  it("opens and closes the sign-in dialog", () => {
    useAuth.getState().openDialog();
    expect(useAuth.getState().dialog).toBe(true);
    useAuth.getState().closeDialog();
    expect(useAuth.getState().dialog).toBe(false);
  });

  it("has words for every reason the server can give", () => {
    for (const reason of ["denied", "state", "failed", "unavailable", "not-allowed", "no-verified-email", "private-email", "github-email", "rate"]) expect(AUTH_NOTICES[reason]).toBeTruthy();
  });

  it("builds the address to start each way in, with where to come back to", () => {
    expect(signInUrl("google", "/editor/a b")).toBe("/api/auth/google/start?returnTo=%2Feditor%2Fa%20b");
    expect(signInUrl("apple", "/")).toBe("/api/auth/apple/start?returnTo=%2F");
    expect(signInUrl("github", "/")).toBe("/api/github/login?purpose=login&returnTo=%2F");
  });
});

describe("the assistant when the sign-in has gone", () => {
  it("says to sign in, opens the dialog and stops loading", async () => {
    handler = (url) => (url === "/api/ai" ? reply({ error: "Sign in to use the assistant.", signInRequired: true }, 401) : reply({ configured: true, providers: { github: false, google: false, apple: false, email: true }, user: null }));
    const out = await useAIStore.getState().sendMessage("hello");
    expect(out).toBeNull();
    const state = useAIStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.messages.at(-1)?.content).toMatch(/Sign in/);
    await vi.waitFor(() => expect(useAuth.getState().dialog).toBe(true));
    expect((calls.find((c) => c.url === "/api/ai")!.init!.headers as Record<string, string>)["x-requested-with"]).toBe("motif");
  });

  it("shows the server's reason for any other refusal", async () => {
    handler = () => reply({ error: "You've reached the limit of 60 messages an hour. Try again in 5 minutes." }, 429);
    await useAIStore.getState().sendMessage("hello");
    expect(useAIStore.getState().messages.at(-1)?.content).toContain("limit of 60");
    expect(useAuth.getState().dialog).toBe(false);
  });
});
