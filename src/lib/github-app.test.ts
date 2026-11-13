import { describe, expect, it, vi } from "vitest";
import { getViewer, listAll, listInstallations, listInstalledRepos } from "./github-app";

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const asFetch = (fn: unknown) => fn as typeof fetch;

describe("what the app can be used on", () => {
  it("reads who is signed in", async () => {
    const f = vi.fn(async () => reply({ login: "ada", avatar_url: "https://avatars.githubusercontent.com/u/1" }));
    expect(await getViewer("ghu_x", asFetch(f))).toEqual({ login: "ada", avatar: "https://avatars.githubusercontent.com/u/1" });
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe("https://api.github.com/user");
    expect(new Headers((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers).get("Authorization")).toBe("Bearer ghu_x");
  });

  it("lists the accounts the app is installed on", async () => {
    const f = async () => reply({ total_count: 2, installations: [{ id: 1, account: { login: "ada" }, repository_selection: "all" }, { id: 2, account: { login: "acme" }, repository_selection: "selected" }] });
    expect(await listInstallations("t", asFetch(f))).toEqual([{ id: 1, account: "ada", selection: "all" }, { id: 2, account: "acme", selection: "selected" }]);
  });

  it("follows the pages", async () => {
    const page = (n: number) => reply({ repositories: Array.from({ length: n }, (_, i) => ({ name: `r${i}`, private: i % 2 === 0, owner: { login: "acme" } })) });
    const f = vi.fn(async (url: string) => (url.endsWith("&page=1") ? page(100) : page(3)));
    const repos = await listInstalledRepos("t", 7, asFetch(f));
    expect(repos).toHaveLength(103);
    expect(repos[0]).toEqual({ owner: "acme", name: "r0", private: true, installation: 7 });
    expect(f).toHaveBeenCalledTimes(2);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://api.github.com/user/installations/7/repositories?per_page=100&page=1");
  });

  it("puts every repository of every installation in one sorted list", async () => {
    const f = async (url: string) => {
      if (url.includes("/user/installations?")) return reply({ installations: [{ id: 1, account: { login: "zed" }, repository_selection: "all" }, { id: 2, account: { login: "acme" }, repository_selection: "selected" }] });
      return url.includes("/1/") ? reply({ repositories: [{ name: "b", owner: { login: "zed" } }] }) : reply({ repositories: [{ name: "z", owner: { login: "acme" } }, { name: "a", private: true, owner: { login: "acme" } }] });
    };
    const out = await listAll("t", asFetch(f));
    expect(out.repos.map((r) => `${r.owner}/${r.name}`)).toEqual(["acme/a", "acme/z", "zed/b"]);
    expect(out.installations).toHaveLength(2);
  });

  it("says so when the sign-in has expired, and what GitHub said otherwise", async () => {
    await expect(listInstallations("t", asFetch(async () => reply({ message: "Bad credentials" }, 401)))).rejects.toThrow("Your GitHub sign-in has expired. Sign in again.");
    await expect(listInstallations("t", asFetch(async () => reply({ message: "Server Error" }, 500)))).rejects.toThrow("Server Error");
  });
});
