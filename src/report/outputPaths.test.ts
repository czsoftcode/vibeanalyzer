import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveOutputPaths } from "./outputPaths.js";

const OUT = "/out";
const STAMP = "2026-06-15T18-40-40-236Z";

describe("resolveOutputPaths", () => {
  it("prázdný adresář → holý stamp bez sufixu (n=0)", async () => {
    const { jsonPath, mdPath } = await resolveOutputPaths(OUT, STAMP, async () => false);
    expect(jsonPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}.json`));
    expect(mdPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}.md`));
  });

  it("kolize na .json → přeskočí na sufix -1 (nepřepíše dřívější výstup)", async () => {
    // jen holý .json existuje (druhý běh ve stejné ms); .md klidně chybí –
    // přesto se MUSÍ posunout celá dvojice, ať .json a .md patří témuž běhu.
    const taken = new Set([path.join(OUT, `vibeanalyzer-${STAMP}.json`)]);
    const { jsonPath, mdPath } = await resolveOutputPaths(OUT, STAMP, async (p) => taken.has(p));
    expect(jsonPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}-1.json`));
    expect(mdPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}-1.md`));
  });

  it("kolize i na .md téhož sufixu → posune se až za obě obsazené dvojice", async () => {
    const taken = new Set([
      path.join(OUT, `vibeanalyzer-${STAMP}.json`),
      path.join(OUT, `vibeanalyzer-${STAMP}.md`),
      path.join(OUT, `vibeanalyzer-${STAMP}-1.md`), // jen .md sufixu -1 obsazené
    ]);
    const { jsonPath, mdPath } = await resolveOutputPaths(OUT, STAMP, async (p) => taken.has(p));
    expect(jsonPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}-2.json`));
    expect(mdPath).toBe(path.join(OUT, `vibeanalyzer-${STAMP}-2.md`));
  });

  it("vše obsazené nad maxAttempts → hodí (žádný tichý přepis ani zacyklení)", async () => {
    await expect(
      resolveOutputPaths(OUT, STAMP, async () => true, 3),
    ).rejects.toThrow(/volný název/);
  });
});
