import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../scan.js";
import { AI_PAYLOAD_CHAR_BUDGET, CHUNK_FILL_RATIO, selectAiCandidates, splitAiPayload } from "./aiPayload.js";

describe("konstanty AI okna (regrese: dohodnuté hodnoty)", () => {
  it("AI_PAYLOAD_CHAR_BUDGET je 1_650_000 znaků ≈ ~500k tokenů", () => {
    expect(AI_PAYLOAD_CHAR_BUDGET).toBe(1_650_000);
  });
  it("CHUNK_FILL_RATIO je 0.75 (plnit okno na max 75 %)", () => {
    expect(CHUNK_FILL_RATIO).toBe(0.75);
  });
});

function file(path: string, ext: string, size = 100, minified = false): FileEntry {
  return { path, type: "file", ext, size, depth: 1, minified };
}

describe("selectAiCandidates – sdílený výběr (reálná funkce, ne kopie)", () => {
  it("vybere jen zdrojové soubory, vytřídí oversized, seřadí podle cesty", () => {
    const files: FileEntry[] = [
      file("z.ts", ".ts", 50),
      file("a.ts", ".ts", 50),
      file("big.ts", ".ts", 10_000_000), // nad per-file stropem → oversized
      file("app.min.js", ".js", 50, true), // minifikát → vůbec ne
      file("readme.md", ".md", 50), // ne-zdroj → vůbec ne
      { path: "src", type: "dir", ext: "", size: 0, depth: 1, minified: false },
    ];
    const out = selectAiCandidates(files);
    expect(out.selected.map((f) => f.path)).toEqual(["a.ts", "z.ts"]); // seřazeno, bez big/min/md/dir
    expect(out.oversizedFiles).toEqual(["big.ts"]);
  });

  it("oversized obsahuje JEN zdrojové kandidáty nad stropem (ne minifikáty/ne-zdroj)", () => {
    const files: FileEntry[] = [
      file("big.ts", ".ts", 10_000_000),
      file("huge.min.js", ".js", 10_000_000, true),
      file("data.json", ".json", 10_000_000),
    ];
    expect(selectAiCandidates(files).oversizedFiles).toEqual(["big.ts"]);
  });
});

describe("splitAiPayload – krájení na části", () => {
  // 8 stejných souborů (jména stejně dlouhá → stejná délka hlavičky), shodný obsah →
  // shodná délka bloku. Konkrétní délku NEhádáme z formátu (riziko kopie literálu):
  // zjistíme ji přes split s obřím oknem (vše v 1 části) a počítáme z reálného výstupu.
  const names = ["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => file(`${n}.ts`, ".ts", 100));
  const read = vi.fn(async () => "x".repeat(50));

  async function pieceLen(): Promise<number> {
    const whole = await splitAiPayload(names, read, 100_000_000);
    expect(whole.chunks).toHaveLength(1);
    return whole.chunks[0]!.text.length / names.length;
  }

  it("malé okno → víc částí (8 souborů, okno na 2 bloky → 4 části po 2)", async () => {
    const L = await pieceLen();
    const out = await splitAiPayload(names, read, L * 2);
    expect(out.chunks).toHaveLength(4);
    for (const c of out.chunks) expect(c.includedFiles).toHaveLength(2);
  });

  it("rovnoměrné dělení: okno na 6 bloků → NE [6,2], ale vyvážené [4,4]", async () => {
    const L = await pieceLen();
    const out = await splitAiPayload(names, read, L * 6); // N = ceil(8/6) = 2, cíl 4 bloky
    expect(out.chunks).toHaveLength(2);
    expect(out.chunks[0]!.includedFiles).toHaveLength(4);
    expect(out.chunks[1]!.includedFiles).toHaveLength(4);
  });

  it("měkký cíl NEvyrobí víc částí než N (ochrana moreChunksNeeded)", async () => {
    // 4 soubory s NEROVNOMĚRNÝMI bloky (poměr ~[12,19,59,12]): velký 3. soubor sám
    // překročí cíl total/N → po něm by měkký cíl bez ochrany uzavřel část a malý 4.
    // soubor by založil N+1. tou částí. Délky NEhádáme z formátu – měříme je.
    const sizes: Record<string, number> = { "a.ts": 101, "b.ts": 171, "c.ts": 571, "d.ts": 101 };
    const files = Object.keys(sizes).map((p) => file(p, ".ts", 100));
    const r = async (p: string) => "x".repeat(sizes[p]!);

    const lens: Record<string, number> = {};
    for (const f of files) lens[f.path] = (await splitAiPayload([f], r, 100_000_000)).chunks[0]!.text.length;
    const total = Object.values(lens).reduce((a, b) => a + b, 0);
    const window = lens["a.ts"]! + lens["b.ts"]! + lens["c.ts"]! - 1; // a+b+c se těsně nevejde

    expect(Math.ceil(total / window)).toBe(2); // scénář je opravdu N=2
    const out = await splitAiPayload(files, r, window);
    expect(out.chunks).toHaveLength(2); // bez ochrany moreChunksNeeded by vznikly 3 části
  });

  it("nic se neztratí ani nezdvojí: součet souborů napříč částmi == všichni kandidáti", async () => {
    const L = await pieceLen();
    const out = await splitAiPayload(names, read, L * 3);
    const seen = out.chunks.flatMap((c) => c.includedFiles.map((f) => f.path));
    expect([...seen].sort()).toEqual(names.map((f) => f.path)); // všech 8, bez duplikátů
    expect(new Set(seen).size).toBe(seen.length); // žádný soubor dvakrát
  });

  it("žádná část nepřekročí okno (kromě single-file přeplněné části)", async () => {
    const L = await pieceLen();
    const window = L * 3;
    const out = await splitAiPayload(names, read, window);
    for (const c of out.chunks) {
      if (c.includedFiles.length > 1) expect(c.text.length).toBeLessThanOrEqual(window);
    }
  });

  it("přetékající soubor (sám > okno) dostane vlastní část, nic se nezahodí", async () => {
    const two = [file("a.ts", ".ts", 100), file("b.ts", ".ts", 100)];
    const r = vi.fn(async () => "x".repeat(50));
    const L = (await splitAiPayload(two, r, 100_000_000)).chunks[0]!.text.length / 2;
    const out = await splitAiPayload(two, r, Math.floor(L / 2)); // okno < jeden blok
    expect(out.chunks).toHaveLength(2);
    for (const c of out.chunks) {
      expect(c.includedFiles).toHaveLength(1);
      expect(c.text.length).toBeGreaterThan(Math.floor(L / 2)); // přeplněná, ale zahrnutá
    }
  });

  it("oversized se do částí nedostanou, vrací se zvlášť", async () => {
    const files = [file("ok.ts", ".ts", 50), file("big.ts", ".ts", 10_000_000)];
    const out = await splitAiPayload(files, async () => "y\n", 1_000);
    expect(out.oversizedFiles).toEqual(["big.ts"]);
    const seen = out.chunks.flatMap((c) => c.includedFiles.map((f) => f.path));
    expect(seen).toEqual(["ok.ts"]); // big.ts není v žádné části
  });

  it("prázdný vstup → prázdné chunks i oversizedFiles, bez pádu", async () => {
    const out = await splitAiPayload([], async () => "x", 1_000);
    expect(out).toEqual({ chunks: [], oversizedFiles: [] });
  });

  it("samé ne-kandidáty (md, dir, minifikát) → prázdné chunks", async () => {
    const files: FileEntry[] = [
      file("readme.md", ".md"),
      file("app.min.js", ".js", 100, true),
      { path: "src", type: "dir", ext: "", size: 0, depth: 1, minified: false },
    ];
    const out = await splitAiPayload(files, async () => "x", 1_000);
    expect(out.chunks).toEqual([]);
  });

  it("determinismus: neseřazený vstup → stejné (seřazené) rozdělení při opakování", async () => {
    const shuffled = [file("c.ts", ".ts"), file("a.ts", ".ts"), file("b.ts", ".ts")];
    const r = async (p: string) => `obsah ${p}\n`;
    const out1 = await splitAiPayload(shuffled, r, 100_000_000);
    const out2 = await splitAiPayload(shuffled, r, 100_000_000);
    expect(JSON.stringify(out1)).toBe(JSON.stringify(out2));
    expect(out1.chunks[0]!.includedFiles.map((f) => f.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("zachytí lineCount každého souboru (kontrola místa proti halucinaci)", async () => {
    const out = await splitAiPayload([file("a.ts", ".ts")], async () => "r1\nr2\nr3", 100_000);
    expect(out.chunks[0]!.includedFiles[0]).toEqual({ path: "a.ts", lineCount: 3 });
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])(
    "window=%s → RangeError (programová chyba volajícího, ne tiché chování)",
    async (bad) => {
      await expect(splitAiPayload([file("a.ts", ".ts")], async () => "x", bad)).rejects.toThrow(RangeError);
    },
  );
});
