import { describe, expect, it } from "vitest";
import { gitBlobSha, GitHostError, type GitHost } from "./github";
import { finishMerge, pull, push, type GitLink } from "./git-sync";
import { parseDocument, serializeDocument, type MotifDocument } from "./motif-document";

function fakeHost() {
  const files = new Map<string, string>();
  const blobs = new Map<string, string>();
  const key = (path: string, branch: string) => `${branch}:${path}`;

  const host: GitHost & { commit(path: string, branch: string, text: string): Promise<string>; read(path: string, branch: string): string | undefined } = {
    getRepo: async () => ({ defaultBranch: "main", canPush: true }),
    listBranches: async () => ["main"],
    createBranch: async () => {},
    listDocuments: async () => [],
    getBlob: async (sha) => blobs.get(sha) ?? null,
    async getFile(path, branch) {
      const text = files.get(key(path, branch));
      return text === undefined ? null : { text, sha: await gitBlobSha(text) };
    },
    async putFile({ path, branch, text, sha }) {
      const current = files.get(key(path, branch));
      const currentSha = current === undefined ? undefined : await gitBlobSha(current);
      if (currentSha !== sha) throw new GitHostError("sha mismatch", 409);
      return { sha: await host.commit(path, branch, text), commitUrl: "https://example.test/commit" };
    },
    async commit(path, branch, text) {
      const sha = await gitBlobSha(text);
      files.set(key(path, branch), text);
      blobs.set(sha, text);
      return sha;
    },
    read: (path, branch) => files.get(key(path, branch)),
  };
  return host;
}

function makeDoc(fills: Record<string, string>): MotifDocument {
  return {
    motif: 1,
    id: "file1",
    name: "Design",
    componentGroups: [],
    components: [{
      id: "comp-main",
      name: "Main",
      groupId: null,
      variantProps: [],
      order: Object.keys(fills),
      elements: Object.fromEntries(
        Object.entries(fills).map(([id, fill]) => [id, { id, type: "rectangle" as const, name: id, x: 0, y: 0, width: 10, height: 10, fill, opacity: 1, rotation: 0 }])
      ),
    }],
  };
}

const PATH = "design/design.motif.json";
const link = (baseSha: string | null): GitLink => ({ repo: "o/r", branch: "main", path: PATH, baseSha });
const fillsOf = (doc: MotifDocument) =>
  Object.fromEntries(Object.values(doc.components[0].elements).map((e) => [e.id, e.fill]));

describe("gitBlobSha", () => {
  it("matches git hash-object", async () => {
    expect(await gitBlobSha("hello\n")).toBe("ce013625030ba8dba906f756967f9e9ca394464a");
    expect(await gitBlobSha("")).toBe("e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
  });
});

describe("push", () => {
  it("creates the file, then reports up-to-date", async () => {
    const host = fakeHost();
    const doc = makeDoc({ a: "#111111" });
    const first = await push(host, link(null), doc, "add");
    expect(first.status).toBe("pushed");
    expect(host.read(PATH, "main")).toBe(serializeDocument(doc));

    const baseSha = first.status === "pushed" ? first.baseSha : null;
    expect(await push(host, link(baseSha), doc, "again")).toEqual({ status: "up-to-date", baseSha });
  });

  it("merges non-overlapping remote changes before writing", async () => {
    const host = fakeHost();
    const baseSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111", b: "#111111" })));
    await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111", b: "#bbbbbb" })));

    const outcome = await push(host, link(baseSha), makeDoc({ a: "#aaaaaa", b: "#111111" }), "mine");
    expect(outcome.status).toBe("pushed");
    expect(fillsOf(parseDocument(host.read(PATH, "main")!))).toEqual({ a: "#aaaaaa", b: "#bbbbbb" });
    if (outcome.status === "pushed") expect(fillsOf(outcome.doc!)).toEqual({ a: "#aaaaaa", b: "#bbbbbb" });
  });

  it("stops on conflicts and pushes the resolution", async () => {
    const host = fakeHost();
    const baseSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111" })));
    const theirs = serializeDocument(makeDoc({ a: "#bbbbbb" }));
    await host.commit(PATH, "main", theirs);

    const outcome = await push(host, link(baseSha), makeDoc({ a: "#aaaaaa" }), "mine");
    expect(outcome.status).toBe("conflicts");
    expect(host.read(PATH, "main")).toBe(theirs);
    if (outcome.status !== "conflicts") return;

    const done = await finishMerge(host, link(baseSha), outcome.pending, []);
    expect(done.status).toBe("pushed");
    expect(fillsOf(parseDocument(host.read(PATH, "main")!))).toEqual({ a: "#aaaaaa" });
  });

  it("keeps a resolved merge locally when the remote moves again", async () => {
    const host = fakeHost();
    const baseSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111" })));
    const remoteSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#bbbbbb" })));
    const outcome = await push(host, link(baseSha), makeDoc({ a: "#aaaaaa" }), "mine");
    if (outcome.status !== "conflicts") throw new Error("expected conflicts");

    await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#cccccc" })));
    const done = await finishMerge(host, link(baseSha), outcome.pending, [0]);
    expect(done).toMatchObject({ status: "pulled", baseSha: remoteSha, pushError: "sha mismatch" });
  });

  it("refuses to overwrite a different design at the same path", async () => {
    const host = fakeHost();
    await host.commit(PATH, "main", serializeDocument({ ...makeDoc({}), id: "other" }));
    await expect(push(host, link(null), makeDoc({ a: "#111111" }), "x")).rejects.toThrow(/different design/);
  });
});

describe("pull", () => {
  it("reports when the branch has no copy of the file", async () => {
    expect(await pull(fakeHost(), link(null), makeDoc({}))).toEqual({ status: "no-remote" });
  });

  it("fast-forwards when there are no local changes", async () => {
    const host = fakeHost();
    const local = makeDoc({ a: "#111111" });
    const baseSha = await host.commit(PATH, "main", serializeDocument(local));
    const remoteSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#bbbbbb" })));

    const outcome = await pull(host, link(baseSha), local);
    expect(outcome).toMatchObject({ status: "pulled", baseSha: remoteSha });
    if (outcome.status === "pulled") expect(fillsOf(outcome.doc)).toEqual({ a: "#bbbbbb" });
  });

  it("leaves unpushed local changes alone when the remote has not moved", async () => {
    const host = fakeHost();
    const baseSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111" })));
    expect(await pull(host, link(baseSha), makeDoc({ a: "#aaaaaa" }))).toEqual({ status: "up-to-date", baseSha });
  });

  it("resolves conflicts without writing to the remote", async () => {
    const host = fakeHost();
    const baseSha = await host.commit(PATH, "main", serializeDocument(makeDoc({ a: "#111111" })));
    const theirs = serializeDocument(makeDoc({ a: "#bbbbbb" }));
    const remoteSha = await host.commit(PATH, "main", theirs);

    const outcome = await pull(host, link(baseSha), makeDoc({ a: "#aaaaaa" }));
    if (outcome.status !== "conflicts") throw new Error("expected conflicts");
    const done = await finishMerge(host, link(baseSha), outcome.pending, [0]);
    expect(done).toMatchObject({ status: "pulled", baseSha: remoteSha });
    expect(host.read(PATH, "main")).toBe(theirs);
  });
});
