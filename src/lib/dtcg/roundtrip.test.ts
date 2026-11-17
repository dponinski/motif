import { describe, expect, it } from "vitest";
import type { StoredTokenData } from "../tokens/model";
import { fixture } from "./fixture";
import { readDtcg } from "./read";
import { writeDtcg } from "./write";

// Tokens compared by id, with what a trip may change (the order tokens of different kinds come back in).
const byId = <T extends { id: string }>(list: T[]) => [...list].sort((a, b) => a.id.localeCompare(b.id));
const normal = (d: StoredTokenData) => ({ sets: d.sets, tokens: byId(d.tokens), compositions: byId(d.compositions) });

describe("design tokens files", () => {
  for (const files of ["single", "per-set"] as const) {
    it(`give back what was written (${files})`, () => {
      const data = fixture();
      const written = writeDtcg(data, { files });
      expect(written.skipped).toEqual([]);
      const back = readDtcg(written.files, data);
      expect(back.notes).toEqual([]);
      expect(normal(back.data)).toEqual(normal(data));
    });
  }
});
