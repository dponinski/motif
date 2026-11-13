import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readPayload, type ProjectPayload } from "../lib/sync/payload";
import { emptyTokenData } from "./design-system";
import { useProjectsStore, type Project } from "./projects";
import { useSync } from "./sync";

// A small server that keeps projects the way the real one does (versions, deletions, refusing a device that is
// behind), so the sync can be run against "another device" by changing what the server has.
interface Row { version: number; data: ProjectPayload | null; deleted: boolean }
class FakeServer {
  rows = new Map<string, Row>();
  calls: { method: string; path: string; body?: unknown }[] = [];
  online = true;
  signedIn = true;
  refuseWith: number | null = null;
  limit = 100;

  reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  current = (id: string) => { const r = this.rows.get(id)!; return { id, version: r.version, updatedAt: 1, deleted: r.deleted, data: r.data }; };
  // What another device does.
  put(id: string, data: ProjectPayload) { const r = this.rows.get(id); this.rows.set(id, { version: (r?.version ?? 0) + 1, data, deleted: false }); }
  drop(id: string) { const r = this.rows.get(id)!; this.rows.set(id, { version: r.version + 1, data: null, deleted: true }); }

  handle = async (url: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path: url, body });
    if (!this.online) throw new TypeError("Failed to fetch");
    if (!this.signedIn) return this.reply(401, { error: "Sign in", signInRequired: true });
    const m = url.match(/^\/api\/projects(?:\/([^?]+))?(?:\?baseVersion=(\d+))?$/);
    if (!m) return this.reply(404, {});
    const id = m[1] ? decodeURIComponent(m[1]) : null;
    if (!id) return this.reply(200, { projects: [...this.rows].map(([pid, r]) => ({ id: pid, version: r.version, updatedAt: 1, deleted: r.deleted })) });
    const row = this.rows.get(id);
    if (method === "GET") return row ? this.reply(200, this.current(id)) : this.reply(404, { error: "no" });
    if (method === "PUT") {
      if (this.refuseWith) return this.reply(this.refuseWith, { error: "Refused" });
      const read = readPayload(body.data);
      if (!read.ok) return this.reply(422, { error: read.error });
      if (!row) {
        if (body.baseVersion !== 0) return this.reply(409, { conflict: true, current: { id, version: 0, updatedAt: 1, deleted: true, data: null } });
        if ([...this.rows.values()].filter((r) => !r.deleted).length >= this.limit) return this.reply(409, { limit: true, error: "limit" });
        this.rows.set(id, { version: 1, data: read.payload, deleted: false });
        return this.reply(200, { version: 1, updatedAt: 1 });
      }
      if (row.version !== body.baseVersion) return this.reply(409, { conflict: true, current: this.current(id) });
      this.rows.set(id, { version: row.version + 1, data: read.payload, deleted: false });
      return this.reply(200, { version: row.version + 1, updatedAt: 1 });
    }
    if (method === "DELETE") {
      if (!row || row.deleted) return this.reply(200, { ok: true });
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
  useSync.getState().dismissNotice();
  useSync.getState().setOpen(null);
});
afterEach(() => vi.unstubAllGlobals());

const sync = () => useSync.getState().sync();
const doc = (title: string) => ({ id: `d-${title}`, title, blocks: [] });

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
    expect(server.calls.map((c) => c.path)).toEqual(["/api/projects"]);
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

  it("in the same part as mine wait for a decision, and nothing is sent or lost", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [doc("Theirs")] }));
    await sync();
    expect(useSync.getState().conflicts.a).toMatchObject({ deleted: false, version: 2, sections: ["docs"] });
    expect(server.writes()).toHaveLength(0);
    expect(local("a")!.docs).toEqual([doc("Mine")]);
    // Asking again doesn't change that or ask twice
    await sync();
    expect(Object.keys(useSync.getState().conflicts)).toEqual(["a"]);
    expect(server.writes()).toHaveLength(0);
  });

  it("can be chosen over mine", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [doc("Theirs")] }));
    await sync();
    await useSync.getState().resolve("a", "server");
    expect(local("a")!.docs).toEqual([doc("Theirs")]);
    expect(useSync.getState().conflicts).toEqual({});
    expect(server.rows.get("a")!.data!.docs).toEqual([doc("Theirs")]);
  });

  it("or mine can be chosen over them", async () => {
    edit("a", (p) => ({ ...p, docs: [doc("Mine")] }));
    server.put("a", payloadOf(project("a"), { docs: [doc("Theirs")] }));
    await sync();
    await useSync.getState().resolve("a", "local");
    expect(server.rows.get("a")!.data!.docs).toEqual([doc("Mine")]);
    expect(server.rows.get("a")!.version).toBe(3);
    expect(local("a")!.docs).toEqual([doc("Mine")]);
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
