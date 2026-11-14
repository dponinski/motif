import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPayload, type ProjectPayload } from "../lib/sync/payload";
import { emptyTokenData } from "./design-system";
import { useProjectsStore, type Project } from "./projects";
import { TEAMS_EVERY, shouldRefreshTeams, useSync } from "./sync";
import { useTeams } from "./teams";

// A small server that keeps projects the way the real one does (versions, deletions, refusing a device that is
// behind), so the sync can be run against "another device" by changing what the server has.
interface Row { version: number; data: ProjectPayload | null; deleted: boolean; teamId?: string | null; updatedBy?: string | null; updatedAt?: number }
class FakeServer {
  rows = new Map<string, Row>();
  calls: { method: string; path: string; body?: unknown }[] = [];
  online = true;
  signedIn = true;
  refuseWith: number | null = null;
  limit = 100;
  // The teams this person is in, with their role; projects of other teams are not theirs to see.
  teams: { id: string; name: string; role: "owner" | "member"; members: unknown[]; invites: unknown[] }[] = [];
  // Ids that are listed as deleted (as a team does when an owner deletes) or not at all (when the person is out of the team).
  unlisted = new Set<string>();
  // Always answers a save with a newer version, as a busy team does.
  alwaysBehind = false;

  reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  current = (id: string) => { const r = this.rows.get(id)!; return { id, version: r.version, updatedAt: r.updatedAt ?? 1, deleted: r.deleted, data: r.data, teamId: r.teamId ?? null, updatedBy: r.updatedBy ?? null }; };
  summary = (id: string) => { const { data: _data, ...rest } = this.current(id); return rest; };
  // What another device does.
  put(id: string, data: ProjectPayload) { const r = this.rows.get(id); this.rows.set(id, { version: (r?.version ?? 0) + 1, data, deleted: false }); }
  drop(id: string) { const r = this.rows.get(id)!; this.rows.set(id, { version: r.version + 1, data: null, deleted: true }); }

  handle = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: url, body });
    if (!this.online) throw new TypeError("Failed to fetch");
    if (!this.signedIn) return this.reply(401, { error: "Sign in", signInRequired: true });
    if (url === "/api/teams") return this.reply(200, { teams: this.teams, invites: [] });
    const move = url.match(/^\/api\/projects\/([^/?]+)\/move$/);
    if (move && method === "POST") {
      const mid = decodeURIComponent(move[1]);
      const mrow = this.rows.get(mid);
      if (!mrow) return this.reply(404, { error: "no" });
      this.rows.set(mid, { ...mrow, version: mrow.version + 1, teamId: body.teamId });
      return this.reply(200, { version: mrow.version + 1, teamId: body.teamId });
    }
    const m = url.match(/^\/api\/projects(?:\/([^?]+))?(?:\?baseVersion=(\d+))?$/);
    if (!m) return this.reply(404, {});
    const id = m[1] ? decodeURIComponent(m[1]) : null;
    if (!id) return this.reply(200, { projects: [...this.rows.keys()].filter((pid) => !this.unlisted.has(pid)).map((pid) => this.summary(pid)) });
    const row = this.rows.get(id);
    if (method === "GET") return row ? this.reply(200, this.current(id)) : this.reply(404, { error: "no" });
    if (method === "PUT") {
      if (this.refuseWith) return this.reply(this.refuseWith, { error: "Refused" });
      if (this.alwaysBehind && row) { this.rows.set(id, { ...row, version: row.version + 1 }); return this.reply(409, { conflict: true, current: this.current(id) }); }
      if (body.teamId && !this.teams.some((t) => t.id === body.teamId)) return this.reply(403, { error: "You aren't in that team", forbidden: true });
      const read = readPayload(body.data);
      if (!read.ok) return this.reply(422, { error: read.error });
      if (!row) {
        if (body.baseVersion !== 0) return this.reply(409, { conflict: true, current: { id, version: 0, updatedAt: 1, deleted: true, data: null } });
        if ([...this.rows.values()].filter((r) => !r.deleted).length >= this.limit) return this.reply(409, { limit: true, error: "limit" });
        this.rows.set(id, { version: 1, data: read.payload, deleted: false, teamId: body.teamId ?? null, updatedBy: body.teamId ? "Me" : null });
        return this.reply(200, { version: 1, updatedAt: 1, teamId: body.teamId ?? null });
      }
      if (row.version !== body.baseVersion) return this.reply(409, { conflict: true, current: this.current(id) });
      this.rows.set(id, { ...row, version: row.version + 1, data: read.payload, deleted: false, ...(row.teamId ? { updatedBy: "Me" } : {}) });
      return this.reply(200, { version: row.version + 1, updatedAt: 1, teamId: row.teamId ?? null });
    }
    if (method === "DELETE") {
      if (!row || row.deleted) return this.reply(200, { ok: true });
      if (row.teamId && this.teams.find((t) => t.id === row.teamId)?.role !== "owner") return this.reply(403, { error: "Only an owner", forbidden: true });
      if (row.version !== Number(m[2])) return this.reply(409, { conflict: true, current: this.current(id) });
      this.drop(id);
      return this.reply(200, { ok: true });
    }
    return this.reply(405, {});
  };
  writes = () => this.calls.filter((c) => c.method !== "GET");
}

const project = (id: string, over: Partial<Project> = {}): Project => ({
  id, name: `Project ${id}`, createdAt: 1, updatedAt: 1,
  repo: { connection: { owner: "acme", repo: id, token: "ghp_" + "S".repeat(36), defaultBranch: "main" }, analysis: null, tokenLink: null },
  library: { source: null, components: [] },
  tokens: emptyTokenData(),
  docs: [],
  ...over,
});
const payloadOf = (p: Project, over: Partial<ProjectPayload> = {}): ProjectPayload => ({
  name: p.name, connection: p.repo.connection && { owner: p.repo.connection.owner, repo: p.repo.connection.repo, defaultBranch: p.repo.connection.defaultBranch },
  tokenLink: null, tokens: p.tokens as never, docs: p.docs, ...over,
});
const local = (id: string) => useProjectsStore.getState().projects.find((p) => p.id === id);
const edit = (id: string, fn: (p: Project) => Project) => useProjectsStore.getState().put(fn(local(id)!));

let server: FakeServer;
beforeEach(() => {
  server = new FakeServer();
  vi.stubGlobal("fetch", vi.fn(server.handle));
  useProjectsStore.setState({ projects: [] });
  useSync.setState({ userId: "u1", meta: {}, status: "idle", conflicts: {}, notice: null, refused: {}, lastSyncedAt: null });
  useTeams.getState().clear();
  useSync.getState().dismissNotice();
  useSync.getState().setOpen(null);
});
afterEach(() => vi.unstubAllGlobals());

const sync = () => useSync.getState().sync();
const doc = (title: string) => ({ id: `d-${title}`, title, blocks: [] });
// The same page (same id) with different content, as two people editing it would make.
const page = (id: string, title: string) => ({ id, title, blocks: [] });

describe("a first sync", () => {
  it("saves the projects that are only in this browser, and says so", async () => {
    useProjectsStore.setState({ projects: [project("a"), project("b")] });
    await sync();
    expect([...server.rows.keys()].sort()).toEqual(["a", "b"]);
    expect(server.rows.get("a")!.data).toEqual(payloadOf(project("a")));
    expect(useSync.getState().meta.a.version).toBe(1);
    expect(useSync.getState().notice).toMatch(/2 projects from this browser/);
    expect(useSync.getState().status).toBe("idle");
  });

  it("never sends an access token, or the scan, or the library", async () => {
    useProjectsStore.setState({ projects: [project("a", { library: { source: null, components: [{ name: "Button" }] as never } })] });
    await sync();
    const sent = JSON.stringify(server.writes());
    expect(sent).not.toContain("ghp_");
    expect(sent).not.toContain("Button");
    expect(sent).not.toContain('"token"');
  });

  it("takes in the projects that are only on the server, with no token", async () => {
    server.put("x", payloadOf(project("x")));
    await sync();
    expect(local("x")).toMatchObject({ id: "x", name: "Project x", repo: { connection: { owner: "acme", repo: "x", token: "" } } });
    expect(useSync.getState().meta.x.version).toBe(1);
  });

  it("does both at once, and a second sync changes nothing", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    server.put("x", payloadOf(project("x")));
    await sync();
    const writes = server.writes().length;
    server.calls = [];
    await sync();
    expect(server.writes()).toHaveLength(0);
    expect(server.calls.map((c) => c.path)).toEqual(["/api/projects", "/api/teams"]);
    expect(writes).toBe(1);
    expect(useProjectsStore.getState().projects.map((p) => p.id).sort()).toEqual(["a", "x"]);
  });
});

describe("changes made here", () => {
  beforeEach(async () => { useProjectsStore.setState({ projects: [project("a")] }); await sync(); server.calls = []; });

  it("are sent, based on the version the server had", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Intro")] }));
    await sync();
    expect(server.writes()).toHaveLength(1);
    expect(server.writes()[0].body).toMatchObject({ baseVersion: 1, data: { docs: [doc("Intro")] } });
    expect(useSync.getState().meta.a.version).toBe(2);
    expect(server.rows.get("a")!.data!.docs).toEqual([doc("Intro")]);
  });

  it("don't include the access token being changed or the project merely being opened", async () => {
    edit("a", (p) => ({ ...p, repo: { ...p.repo, connection: { ...p.repo.connection!, token: "ghp_" + "N".repeat(36) } }, updatedAt: 99 }));
    await sync();
    expect(server.writes()).toHaveLength(0);
  });

  it("are sent again once, not repeatedly", async () => {
    edit("a", (p) => ({ ...p, name: "Renamed" }));
    await sync(); await sync();
    expect(server.writes()).toHaveLength(1);
  });

  it("deleting a project deletes it on the server", async () => {
    useProjectsStore.getState().remove("a");
    await sync();
    expect(server.writes()).toEqual([expect.objectContaining({ method: "DELETE", path: "/api/projects/a?baseVersion=1" })]);
    expect(server.rows.get("a")!.deleted).toBe(true);
    expect(useSync.getState().meta.a).toBeUndefined();
  });

  it("deleting a project that was changed elsewhere brings the other version back", async () => {
    server.put("a", payloadOf(project("a"), { name: "Elsewhere" }));
    useProjectsStore.getState().remove("a");
    await sync();
    expect(server.rows.get("a")!.deleted).toBe(false);
    expect(local("a")?.name).toBe("Elsewhere");
  });
});

describe("changes made elsewhere", () => {
  beforeEach(async () => { useProjectsStore.setState({ projects: [project("a")] }); await sync(); server.calls = []; });

  it("are taken in, keeping this device's access token", async () => {
    server.put("a", payloadOf(project("a"), { name: "Renamed", docs: [doc("Intro")] }));
    await sync();
    expect(local("a")).toMatchObject({ name: "Renamed", docs: [doc("Intro")], repo: { connection: { token: "ghp_" + "S".repeat(36) } } });
    expect(server.writes()).toHaveLength(0);
    expect(useSync.getState().meta.a.version).toBe(2);
  });

  it("in a different part from mine are combined with mine, and the result is sent", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.put("a", payloadOf(project("a"), { name: "Theirs" }));
    await sync();
    expect(local("a")).toMatchObject({ name: "Theirs", docs: [doc("Mine")] });
    expect(server.rows.get("a")!.data).toMatchObject({ name: "Theirs", docs: [doc("Mine")] });
    expect(server.rows.get("a")!.version).toBe(3);
    expect(useSync.getState().conflicts).toEqual({});
  });

  it("in the same item as mine wait for a decision, and nothing is sent or lost", async () => {
    edit("a", (p) => ({ ...p, docs: [page("d1", "Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [page("d1", "Theirs")] }));
    await sync();
    expect(useSync.getState().conflicts.a).toMatchObject({ deleted: false, version: 2, sections: [], items: [{ section: "docs", key: "d1", name: "Mine" }] });
    expect(server.writes()).toHaveLength(0);
    expect(local("a")!.docs).toEqual([page("d1", "Mine")]);
    // Asking again doesn't change that or ask twice
    await sync();
    expect(Object.keys(useSync.getState().conflicts)).toEqual(["a"]);
    expect(server.writes()).toHaveLength(0);
  });

  it("in different items of the same part are both kept, with nothing to ask", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [doc("Theirs")] }));
    await sync();
    expect(useSync.getState().conflicts).toEqual({});
    expect(local("a")!.docs.map((d) => d.title).sort()).toEqual(["Mine", "Theirs"]);
    expect(server.rows.get("a")!.data!.docs.map((d) => (d as { title: string }).title).sort()).toEqual(["Mine", "Theirs"]);
    expect(server.rows.get("a")!.version).toBe(3);
  });

  it("two people editing different tokens at once both keep their edits", async () => {
    const withColors = (a: string, b: string) => ({ ...emptyTokenData(), colors: [{ id: "c1", name: "primary", value: a }, { id: "c2", name: "surface", value: b }] }) as never;
    useProjectsStore.setState({ projects: [] });
    useProjectsStore.getState().put(project("a", { tokens: withColors("#111111", "#222222") }));
    await sync();
    server.calls = [];
    // This person edits the first color; a teammate edits the second, on the server.
    edit("a", (p) => ({ ...p, tokens: withColors("#AAAAAA", "#222222") }));
    server.put("a", payloadOf(project("a"), { tokens: withColors("#111111", "#BBBBBB") as never }));
    await sync();
    expect(useSync.getState().conflicts).toEqual({});
    const merged = (server.rows.get("a")!.data!.tokens as unknown as { colors: { value: string }[] }).colors.map((c) => c.value);
    expect(merged).toEqual(["#AAAAAA", "#BBBBBB"]);
    expect(local("a")!.tokens.colors.map((c) => c.value)).toEqual(["#AAAAAA", "#BBBBBB"]);
  });

  it("a page deleted by one and edited by the other is asked about, by name, and the rest is merged", async () => {
    useProjectsStore.getState().put(project("a", { docs: [page("d1", "One"), page("d2", "Two")] }));
    await sync();
    server.calls = [];
    edit("a", (p) => ({ ...p, docs: [page("d1", "One")] }));
    server.put("a", payloadOf(project("a"), { docs: [page("d1", "One"), page("d2", "Two edited"), page("d3", "Added there")] }));
    await sync();
    const c = useSync.getState().conflicts.a;
    expect(c.items!.map((i) => i.key)).toEqual(["d2"]);
    await useSync.getState().resolve("a", "server");
    expect(local("a")!.docs.map((d) => d.title)).toEqual(["One", "Two edited", "Added there"]);
  });

  it("can be chosen over mine", async () => {
    edit("a", (p) => ({ ...p, docs: [page("d1", "Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [page("d1", "Theirs")] }));
    await sync();
    await useSync.getState().resolve("a", "server");
    expect(local("a")!.docs).toEqual([page("d1", "Theirs")]);
    expect(useSync.getState().conflicts).toEqual({});
    expect(server.rows.get("a")!.data!.docs).toEqual([page("d1", "Theirs")]);
  });

  it("keeping mine keeps the other person's changes to everything else, here and on the server, from then on", async () => {
    edit("a", (p) => ({ ...p, docs: [page("d1", "Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [page("d1", "Theirs"), page("d3", "Added there")] }));
    await sync();
    await useSync.getState().resolve("a", "local");
    await sync();
    const titles = (docs: unknown[]) => docs.map((d) => (d as { title: string }).title);
    expect(titles(server.rows.get("a")!.data!.docs)).toEqual(["Mine", "Added there"]);
    expect(local("a")!.docs.map((d) => d.title)).toEqual(["Mine", "Added there"]);
    expect(useSync.getState().conflicts).toEqual({});
  });

  it("or mine can be chosen over them", async () => {
    edit("a", (p) => ({ ...p, docs: [page("d1", "Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [page("d1", "Theirs")] }));
    await sync();
    await useSync.getState().resolve("a", "local");
    expect(server.rows.get("a")!.data!.docs).toEqual([page("d1", "Mine")]);
    expect(server.rows.get("a")!.version).toBe(3);
    expect(local("a")!.docs).toEqual([page("d1", "Mine")]);
    expect(useSync.getState().conflicts).toEqual({});
  });

  it("a deletion is taken in when I hadn't changed the project", async () => {
    server.drop("a");
    await sync();
    expect(local("a")).toBeUndefined();
    expect(useSync.getState().meta.a).toBeUndefined();
  });

  it("a deletion of a project I changed waits for a decision: delete it here too, or keep it", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.drop("a");
    await sync();
    expect(useSync.getState().conflicts.a).toMatchObject({ deleted: true, version: 2 });
    expect(local("a")).toBeDefined();
    await useSync.getState().resolve("a", "local");
    expect(server.rows.get("a")).toMatchObject({ deleted: false, version: 3, data: { docs: [doc("Mine")] } });

    // And the other choice
    edit("a", (p) => ({ ...p, docs: [doc("Again")] }));
    server.drop("a");
    await sync();
    await useSync.getState().resolve("a", "server");
    expect(local("a")).toBeUndefined();
  });

  it("a project the server has forgotten is dropped if unchanged, and asked about if changed", async () => {
    useProjectsStore.setState({ projects: [project("a"), project("b")] });
    await sync();
    server.rows.delete("a"); server.rows.delete("b");
    edit("b", (p) => ({ ...p, name: "Changed" }));
    await sync();
    expect(local("a")).toBeUndefined();
    expect(useSync.getState().conflicts.b).toMatchObject({ deleted: true, version: 0 });
    await useSync.getState().resolve("b", "local");
    expect(server.rows.get("b")!.data!.name).toBe("Changed");
  });
});

describe("the editor that is open", () => {
  it("is asked for its latest first, and given a change that arrives", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    await sync();
    const flush = vi.fn();
    const reload = vi.fn();
    useSync.getState().setOpen({ id: "a", flush, reload });
    server.put("a", payloadOf(project("a"), { name: "Elsewhere" }));
    await sync();
    expect(flush).toHaveBeenCalled();
    expect(reload).toHaveBeenCalledWith(expect.objectContaining({ id: "a", name: "Elsewhere" }));
  });

  it("isn't reloaded for a change to another project", async () => {
    useProjectsStore.setState({ projects: [project("a"), project("b")] });
    await sync();
    const reload = vi.fn();
    useSync.getState().setOpen({ id: "a", flush: () => {}, reload });
    server.put("b", payloadOf(project("b"), { name: "Elsewhere" }));
    await sync();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("when things go wrong", () => {
  it("being offline leaves everything as it is, and the next sync catches up", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    server.online = false;
    await sync();
    expect(useSync.getState().status).toBe("offline");
    expect(local("a")).toBeDefined();
    expect(server.rows.size).toBe(0);
    server.online = true;
    await sync();
    expect(useSync.getState().status).toBe("idle");
    expect(server.rows.has("a")).toBe(true);
  });

  it("a server error counts as offline", async () => {
    server.handle = async () => new Response("", { status: 502 });
    vi.stubGlobal("fetch", vi.fn(server.handle));
    await sync();
    expect(useSync.getState().status).toBe("offline");
  });

  it("a session that has ended stops syncing without touching projects", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    server.signedIn = false;
    await sync();
    expect(useSync.getState().status).toBe("off");
    expect(local("a")).toBeDefined();
  });

  it("a project the server refuses is reported and not sent again until it changes", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    server.refuseWith = 422;
    await sync();
    expect(useSync.getState().status).toBe("error");
    expect(Object.keys(useSync.getState().refused)).toEqual(["a"]);
    server.refuseWith = null;
    server.calls = [];
    await sync();
    expect(server.writes()).toHaveLength(0);
    edit("a", (p) => ({ ...p, name: "Fixed" }));
    await sync();
    expect(server.rows.get("a")!.data!.name).toBe("Fixed");
    expect(useSync.getState().status).toBe("idle");
    expect(useSync.getState().refused).toEqual({});
  });

  it("an account that is full keeps the project here and says so", async () => {
    server.limit = 1;
    useProjectsStore.setState({ projects: [project("a"), project("b")] });
    await sync();
    expect(server.rows.size).toBe(1);
    expect(local("b")).toBeDefined();
    expect(useSync.getState().notice).toMatch(/limit of saved projects/);
  });

  it("does nothing when nobody is signed in", async () => {
    useSync.setState({ userId: null });
    useProjectsStore.setState({ projects: [project("a")] });
    await sync();
    expect(server.calls).toHaveLength(0);
  });

  it("runs one sync at a time and runs again if asked meanwhile", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    await Promise.all([sync(), sync(), sync()]);
    expect(server.writes()).toHaveLength(1);
  });
});

describe("signing out and in", () => {
  beforeEach(async () => { useProjectsStore.setState({ projects: [project("a"), project("b")] }); await sync(); });

  it("takes what is saved off the browser, after sending what wasn't", async () => {
    edit("a", (p) => ({ ...p, name: "Last minute" }));
    await useSync.getState().stop({ clear: true });
    expect(useProjectsStore.getState().projects).toEqual([]);
    expect(server.rows.get("a")!.data!.name).toBe("Last minute");
    expect(useSync.getState()).toMatchObject({ userId: null, meta: {}, status: "off" });
  });

  it("keeps a project it couldn't send, for its owner", async () => {
    server.online = false;
    edit("a", (p) => ({ ...p, name: "Unsent" }));
    await useSync.getState().stop({ clear: true });
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(["a"]);
    expect(useSync.getState().userId).toBe("u1");
    expect(Object.keys(useSync.getState().meta)).toEqual(["a"]);
  });

  it("stopping without signing out leaves everything", async () => {
    await useSync.getState().stop();
    expect(useProjectsStore.getState().projects).toHaveLength(2);
    expect(useSync.getState().meta.a).toBeDefined();
  });

  it("a different person signing in on this browser does not get the first person's projects", async () => {
    server.online = false;
    edit("a", (p) => ({ ...p, name: "Unsent" }));
    await useSync.getState().stop({ clear: true });
    server.online = true;
    server.rows.clear();
    // A project made while signed out belongs to whoever signs in next.
    useProjectsStore.getState().put(project("mine"));
    const stub = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal("window", stub);
    vi.stubGlobal("document", { ...stub, visibilityState: "visible" });
    useSync.getState().start("u2");
    await useSync.getState().sync();
    expect(useProjectsStore.getState().projects.map((p) => p.id)).toEqual(["mine"]);
    expect([...server.rows.keys()]).toEqual(["mine"]);
    await useSync.getState().stop();
    vi.unstubAllGlobals();
  });
});

describe("projects shared with a team", () => {
  const team = (role: "owner" | "member" = "member") => ({ id: "t1", name: "Design", role, members: [], invites: [] });
  beforeEach(() => { server.teams = [team()]; });

  it("a new design system made in a team is saved there, and who last changed it is shown", async () => {
    useProjectsStore.setState({ projects: [project("a", { teamId: "t1" })] });
    await sync();
    expect(server.writes()[0].body).toMatchObject({ baseVersion: 0, teamId: "t1" });
    expect(server.rows.get("a")!.teamId).toBe("t1");
    expect(local("a")).toMatchObject({ teamId: "t1" });
    await sync();
    expect(local("a")).toMatchObject({ teamId: "t1", updatedBy: "Me" });
    expect(useTeams.getState().teams.map((t) => t.name)).toEqual(["Design"]);
  });

  it("is saved as the person's own when they turn out not to be in that team", async () => {
    server.teams = [];
    useProjectsStore.setState({ projects: [project("a", { teamId: "t1" })] });
    await sync();
    expect(server.rows.get("a")!.teamId).toBeNull();
    expect(local("a")!.teamId).toBeNull();
  });

  it("a teammate's design system comes in with its team, who changed it and when, not 'just now'", async () => {
    server.rows.set("x", { version: 3, data: payloadOf(project("x")), deleted: false, teamId: "t1", updatedBy: "Grace", updatedAt: 777 });
    await sync();
    expect(local("x")).toMatchObject({ teamId: "t1", updatedBy: "Grace", updatedAt: 777 });
    // And her next change arrives the same way.
    server.rows.set("x", { version: 4, data: payloadOf(project("x"), { docs: [doc("From Grace")] }), deleted: false, teamId: "t1", updatedBy: "Grace", updatedAt: 888 });
    await sync();
    expect(local("x")).toMatchObject({ updatedBy: "Grace", updatedAt: 888, docs: [doc("From Grace")] });
  });

  describe("when the person is no longer in the team", () => {
    beforeEach(async () => {
      server.rows.set("x", { version: 1, data: payloadOf(project("x")), deleted: false, teamId: "t1", updatedBy: "Grace" });
      await sync();
      server.calls = [];
      server.unlisted.add("x");
      server.teams = [];
    });
    it("a design system they hadn't changed is taken off this browser, and they are told", async () => {
      await sync();
      expect(local("x")).toBeUndefined();
      expect(useSync.getState().notice).toMatch(/no longer in the team that shared “Project x”.*taken off this browser/);
      expect(useSync.getState().meta.x).toBeUndefined();
    });
    it("their own changes are kept as their own project, and saved to their account", async () => {
      edit("x", (p) => ({ ...p, docs: [doc("Mine")] }));
      server.unlisted.delete("x");
      server.rows.delete("x");
      await sync();
      expect(useSync.getState().notice).toMatch(/Your changes are kept as your own project/);
      expect(local("x")).toMatchObject({ teamId: null, docs: [doc("Mine")] });
      expect(server.rows.get("x")).toMatchObject({ teamId: null, version: 1 });
    });
  });

  it("a member can't delete a team's design system: it stays, and they are told", async () => {
    server.rows.set("x", { version: 1, data: payloadOf(project("x")), deleted: false, teamId: "t1" });
    await sync();
    useProjectsStore.getState().remove("x");
    await sync();
    expect(server.rows.get("x")!.deleted).toBe(false);
    expect(useSync.getState().notice).toMatch(/Only an owner of the team/);
    expect(local("x")).toBeDefined();
  });

  it("an owner deleting it deletes it for the team, and a teammate's device drops it", async () => {
    server.teams = [team("owner")];
    server.rows.set("x", { version: 1, data: payloadOf(project("x")), deleted: false, teamId: "t1" });
    await sync();
    useProjectsStore.getState().remove("x");
    await sync();
    expect(server.rows.get("x")!.deleted).toBe(true);
  });

  it("a move into a team is not a deletion: the project stays, in its team", async () => {
    useProjectsStore.setState({ projects: [project("a")] });
    await sync();
    const error = await useSync.getState().move("a", "t1");
    expect(error).toBeNull();
    expect(local("a")).toMatchObject({ teamId: "t1" });
    expect(useSync.getState().meta.a.version).toBe(2);
    expect(server.rows.get("a")).toMatchObject({ teamId: "t1", version: 2 });
    expect(local("a")).toBeDefined();
  });

  it("on another device a project listed both as deleted (where it was) and alive (in the team) is the live one", async () => {
    server.rows.set("a", { version: 1, data: payloadOf(project("a")), deleted: false });
    await sync();
    // The server lists the old place as deleted, and the new as alive, under the same id.
    const list = server.handle;
    server.handle = async (url, init) => {
      if (url === "/api/projects" && (init?.method ?? "GET") === "GET") {
        return server.reply(200, { projects: [
          { id: "a", version: 2, updatedAt: 1, deleted: true, teamId: null, updatedBy: null },
          { id: "a", version: 3, updatedAt: 1, deleted: false, teamId: "t1", updatedBy: "Grace" },
        ] });
      }
      return list(url, init);
    };
    server.rows.set("a", { version: 3, data: payloadOf(project("a")), deleted: false, teamId: "t1", updatedBy: "Grace" });
    await sync();
    expect(local("a")).toMatchObject({ teamId: "t1", updatedBy: "Grace" });
    expect(useSync.getState().conflicts.a).toBeUndefined();
  });

  it("losing several saves in a row to busy teammates is tried again, not shown as refused", async () => {
    vi.useFakeTimers();
    try {
      useProjectsStore.setState({ projects: [project("a")] });
      await sync();
      server.alwaysBehind = true;
      edit("a", (p) => ({ ...p, docs: [doc("Busy")] }));
      await sync();
      expect(useSync.getState().refused).toEqual({});
      expect(useSync.getState().status).not.toBe("error");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("how often sync asks about teams", () => {
  it("asks in the first round, then every few, and in between only for a team it doesn't know", () => {
    expect(shouldRefreshTeams(0, false, [], [])).toBe(true);
    expect(shouldRefreshTeams(1, false, [], [])).toBe(true);
    const asked = Array.from({ length: TEAMS_EVERY * 2 + 1 }, (_, i) => shouldRefreshTeams(i, true, ["t1"], ["t1", null, undefined]));
    expect(asked.filter(Boolean)).toHaveLength(3);
    expect(asked[0] && asked[TEAMS_EVERY] && asked[TEAMS_EVERY * 2]).toBe(true);
    expect(shouldRefreshTeams(1, true, ["t1"], ["t1", "t2"])).toBe(true);
  });
});
