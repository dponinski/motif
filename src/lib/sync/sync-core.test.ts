import { describe, expect, it } from "vitest";
import { applyTake, decide } from "./engine";
import { SECTIONS, hashSections, hashText, readPayload, sameHashes, stableStringify, toPayload, type ProjectPayload } from "./payload";
import { applyPayload, projectFromPayload } from "./project";
import type { Project } from "@/store/projects";

const payload = (over: Partial<ProjectPayload> = {}): ProjectPayload => ({
  name: "Acme",
  connection: { owner: "acme", repo: "ds", defaultBranch: "main" },
  tokenLink: null,
  tokens: { colors: [{ id: "c1", name: "primary", value: "#fff" }] },
  docs: [{ id: "p1", title: "Intro", blocks: [] }],
  ...over,
});

describe("what a project is, to the server", () => {
  it("hashes the same value the same way whatever order its keys are in", () => {
    expect(stableStringify({ b: 1, a: [{ d: 1, c: undefined, e: 2 }] })).toBe(stableStringify({ a: [{ e: 2, d: 1 }], b: 1 }));
    expect(hashText("a")).not.toBe(hashText("b"));
    expect(hashText("abc")).toBe(hashText("abc"));
  });

  it("hashes each part on its own", () => {
    const a = hashSections(payload());
    const b = hashSections(payload({ docs: [] }));
    expect(SECTIONS.filter((s) => a[s] !== b[s])).toEqual(["docs"]);
    expect(sameHashes(a, hashSections(payload()))).toBe(true);
  });

  it("makes the payload from a project without its access token, scan or library", () => {
    const project = {
      name: "  Acme  ",
      repo: { connection: { owner: "acme", repo: "ds", token: "github_pat_" + "x".repeat(30), defaultBranch: "dev" }, analysis: { big: true }, tokenLink: null },
      library: { source: null, components: [{ name: "Button" }] },
      tokens: { colors: [] },
      docs: [],
    };
    const out = toPayload(project as never);
    expect(JSON.stringify(out)).not.toContain("github_pat_");
    expect(out).toEqual({ name: "Acme", connection: { owner: "acme", repo: "ds", defaultBranch: "dev" }, tokenLink: null, tokens: { colors: [] }, docs: [] });
    expect(toPayload({ ...project, name: " ", repo: { ...project.repo, connection: null } } as never).name).toBe("Untitled");
  });
});

describe("reading what a page sent", () => {
  it("accepts a project and keeps only the known parts of it", () => {
    const r = readPayload({ ...payload(), extra: "x", connection: { owner: "acme", repo: "ds", defaultBranch: "main", token: "secret" } });
    expect(r.ok && r.payload).toEqual(payload());
    expect(r.ok && "extra" in r.payload).toBe(false);
  });

  it("refuses what isn't a project", () => {
    for (const bad of [null, "x", [], {}, { ...payload(), name: " " }, { ...payload(), name: "x".repeat(201) }, { ...payload(), tokens: [] }, { ...payload(), docs: {} }, { ...payload(), tokenLink: [] },
      { ...payload(), connection: { owner: "a/b", repo: "ds" } }, { ...payload(), connection: { owner: "acme", repo: "..;rm" } }, { ...payload(), connection: "acme/ds" }]) {
      expect(readPayload(bad).ok).toBe(false);
    }
  });

  it("refuses what looks like an access token anywhere in it, and anything too large", () => {
    for (const secret of ["ghp_" + "A".repeat(36), "github_pat_" + "B".repeat(40), "ghu_" + "c".repeat(30), "ghs_" + "d".repeat(30)]) {
      const r = readPayload(payload({ docs: [{ blocks: [{ text: `use ${secret} here` }] }] }));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error).toMatch(/access token/);
    }
    expect(readPayload(payload({ tokens: { big: "x".repeat(1_600_000) } })).ok).toBe(false);
    // Ordinary words that start the same are fine.
    expect(readPayload(payload({ docs: [{ text: "ghp_short and github_pat_x" }] })).ok).toBe(true);
  });

  it("defaults a missing branch", () => {
    const r = readPayload({ ...payload(), connection: { owner: "acme", repo: "ds" } });
    expect(r.ok && r.payload.connection?.defaultBranch).toBe("main");
  });
});

describe("deciding what to do about a project", () => {
  const base = hashSections(payload());
  const meta = { version: 3, hashes: base };
  const withDocs = hashSections(payload({ docs: [] }));
  const withTokens = hashSections(payload({ tokens: { colors: [] } }));
  const both = hashSections(payload({ docs: [], tokens: { colors: [] } }));

  it("does nothing when they are the same", () => {
    expect(decide(meta, base, base)).toEqual({ kind: "idle" });
    expect(decide(null, base, base)).toEqual({ kind: "idle" });
  });
  it("sends what only this device changed, and takes what only the server changed", () => {
    expect(decide(meta, withDocs, base)).toEqual({ kind: "push" });
    expect(decide(meta, base, withDocs)).toEqual({ kind: "pull" });
  });
  it("combines changes to different parts", () => {
    const d = decide(meta, withDocs, withTokens);
    expect(d).toMatchObject({ kind: "merge", take: { docs: "local", tokens: "server", name: "local" } });
    if (d.kind !== "merge") throw new Error();
    const merged = applyTake(payload({ docs: [] }), payload({ tokens: { colors: [] } }), d.take);
    expect(merged).toEqual(payload({ docs: [], tokens: { colors: [] } }));
  });
  it("is not a conflict when both made the same change", () => {
    expect(decide(meta, withDocs, withDocs)).toEqual({ kind: "idle" });
    // The server already has the tokens change; only the docs change is left to send.
    const d = decide(meta, both, withTokens);
    expect(d).toMatchObject({ kind: "merge", take: { tokens: "server", docs: "local" } });
    if (d.kind !== "merge") throw new Error();
    expect(applyTake(payload({ docs: [], tokens: { colors: [] } }), payload({ tokens: { colors: [] } }), d.take)).toEqual(payload({ docs: [], tokens: { colors: [] } }));
  });
  it("is a conflict when the same part was changed differently", () => {
    const other = hashSections(payload({ docs: [{ id: "p2" }] }));
    expect(decide(meta, withDocs, other)).toEqual({ kind: "conflict", sections: ["docs"] });
    // Changes elsewhere don't hide it
    expect(decide(meta, both, other)).toEqual({ kind: "conflict", sections: ["docs"] });
  });
  it("is a conflict, naming the differing parts, when they never agreed", () => {
    expect(decide(null, withDocs, base)).toEqual({ kind: "conflict", sections: ["docs"] });
  });
});

describe("moving a project's parts between the server and the browser", () => {
  const local = (): Project => ({
    id: "p1", name: "Old", createdAt: 1, updatedAt: 2,
    repo: { connection: { owner: "acme", repo: "ds", token: "ghp_local", defaultBranch: "main" }, analysis: { scan: true } as never, tokenLink: null },
    library: { source: null, components: [{ name: "Button" }] as never },
    tokens: { sets: [] } as never,
    docs: [],
  });

  it("makes a project from the server with no token, scan or library", () => {
    const p = projectFromPayload("p9", payload());
    expect(p).toMatchObject({ id: "p9", name: "Acme", repo: { connection: { owner: "acme", repo: "ds", token: "", defaultBranch: "main" }, analysis: null }, library: { components: [] } });
    expect(p.tokens.sets).toBeDefined();
  });

  it("takes the server's parts but keeps this device's token, scan and library for the same repository", () => {
    const p = applyPayload(local(), payload({ name: "New" }));
    expect(p.name).toBe("New");
    expect(p.repo.connection).toEqual({ owner: "acme", repo: "ds", token: "ghp_local", defaultBranch: "main" });
    expect(p.repo.analysis).toEqual({ scan: true });
    expect(p.library.components).toHaveLength(1);
  });

  it("drops them for a different repository, so a token never goes to another one", () => {
    const p = applyPayload(local(), payload({ connection: { owner: "other", repo: "kit", defaultBranch: "main" } }));
    expect(p.repo.connection).toEqual({ owner: "other", repo: "kit", token: "", defaultBranch: "main" });
    expect(p.repo.analysis).toBeNull();
    expect(p.library.components).toHaveLength(0);
  });
});
