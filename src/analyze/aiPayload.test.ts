import { describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../scan.js";
import { AI_PAYLOAD_CHAR_BUDGET, collectAiPayload } from "./aiPayload.js";

function file(path: string, ext: string, size = 100, minified = false): FileEntry {
  return { path, type: "file", ext, size, depth: 1, minified };
}

describe("collectAiPayload – výběr a ohraničení payloadu", () => {
  it("vybere jen zdrojové soubory; přeskočí ne-zdrojové, minifikáty a adresáře", async () => {
    const files: FileEntry[] = [
      file("a.ts", ".ts"),
      file("b.js", ".js"),
      file("readme.md", ".md"),
      file("app.min.js", ".js", 100, true),
      { path: "src", type: "dir", ext: "", size: 0, depth: 1, minified: false },
    ];
    const read = vi.fn(async (p: string) => `obsah ${p}\n`);
    const out = await collectAiPayload(files, read);

    const paths = out.includedFiles.map((f) => f.path);
    expect(paths).toEqual(["a.ts", "b.js"]); // jen .ts/.js, bez minifikátu/md/dir
    expect(read).not.toHaveBeenCalledWith("readme.md");
    expect(read).not.toHaveBeenCalledWith("app.min.js");
    expect(out.text).toContain("// ==== a.ts ====");
    expect(out.truncated).toBe(false);
  });

  it("přeskočí soubory nad per-file stropem (FileEntry.size, bez čtení) a PŘIZNÁ je v oversizedFiles", async () => {
    const files: FileEntry[] = [file("big.ts", ".ts", 10_000_000), file("ok.ts", ".ts", 50)];
    const read = vi.fn(async () => "x\n");
    const out = await collectAiPayload(files, read);
    expect(out.includedFiles.map((f) => f.path)).toEqual(["ok.ts"]);
    expect(read).not.toHaveBeenCalledWith("big.ts");
    expect(out.oversizedFiles).toEqual(["big.ts"]); // ne tiché vynechání
  });

  it("oversizedFiles obsahuje JEN zdrojové kandidáty nad stropem (ne minifikáty/ne-zdroj)", async () => {
    const files: FileEntry[] = [
      file("big.ts", ".ts", 10_000_000), // zdroj nad stropem → patří tam
      file("huge.min.js", ".js", 10_000_000, true), // minifikát nad stropem → NE (není kandidát)
      file("data.json", ".json", 10_000_000), // ne-zdroj nad stropem → NE
      file("ok.ts", ".ts", 50), // zdroj v limitu → NE (vejde se)
    ];
    const out = await collectAiPayload(files, async () => "x\n");
    expect(out.oversizedFiles).toEqual(["big.ts"]);
  });

  it("bez velkých souborů je oversizedFiles prázdné", async () => {
    const out = await collectAiPayload([file("a.ts", ".ts", 50)], async () => "x\n");
    expect(out.oversizedFiles).toEqual([]);
  });

  it("strop má dohodnutou hodnotu 1_650_000 znaků ≈ ~500k tokenů (regrese: relativní truncation test špatnou hodnotu nechytí)", () => {
    expect(AI_PAYLOAD_CHAR_BUDGET).toBe(1_650_000);
  });

  it("zachytí počet řádků každého souboru (pro pozdější kontrolu místa)", async () => {
    const files: FileEntry[] = [file("a.ts", ".ts")];
    const read = vi.fn(async () => "r1\nr2\nr3"); // 3 řádky bez koncového \n
    const out = await collectAiPayload(files, read);
    expect(out.includedFiles[0]).toEqual({ path: "a.ts", lineCount: 3 });
  });

  it("počet řádků nepřičítá koncový \\n (3 řádky s koncovým newline = 3, ne 4)", async () => {
    const out = await collectAiPayload([file("a.ts", ".ts")], async () => "r1\nr2\nr3\n");
    expect(out.includedFiles[0]!.lineCount).toBe(3); // ne 4 – jinak by halucinace na řádku 4 prošla
  });

  it("prázdný soubor → 0 řádků (ne 1)", async () => {
    const out = await collectAiPayload([file("a.ts", ".ts")], async () => "");
    expect(out.includedFiles[0]!.lineCount).toBe(0);
  });

  it("nad stropem uřízne a PŘIZNÁ to (truncated:true + počty), ne tiché vynechání", async () => {
    // dva soubory, každý ~70 % stropu → druhý se nevejde. b.ts má známou velikost (size),
    // ať se dá ověřit omittedBytes (počítá se z FileEntry.size, ne z přečteného obsahu).
    const half = "x".repeat(Math.floor(AI_PAYLOAD_CHAR_BUDGET * 0.7));
    const files: FileEntry[] = [file("a.ts", ".ts", 12_345), file("b.ts", ".ts", 99_999)];
    const read = vi.fn(async () => half);
    const out = await collectAiPayload(files, read);
    expect(out.includedFiles.map((f) => f.path)).toEqual(["a.ts"]); // b se nevešlo
    expect(out.truncated).toBe(true);
    expect(out.omittedFiles).toBe(1); // jen b.ts
    expect(out.omittedBytes).toBe(99_999); // velikost b.ts ze scanu, ne délka uříznutého textu
  });

  it("bez uříznutí jsou počty nulové (truncated=false → omittedFiles/omittedBytes = 0)", async () => {
    const files: FileEntry[] = [file("a.ts", ".ts", 50), file("b.ts", ".ts", 60)];
    const out = await collectAiPayload(files, async (p) => `${p}\n`);
    expect(out.truncated).toBe(false);
    expect(out.omittedFiles).toBe(0);
    expect(out.omittedBytes).toBe(0);
  });

  it("výběr je deterministický (seřazený podle cesty)", async () => {
    const files: FileEntry[] = [file("z.ts", ".ts"), file("a.ts", ".ts"), file("m.ts", ".ts")];
    const read = vi.fn(async (p: string) => `${p}\n`);
    const out = await collectAiPayload(files, read);
    expect(out.includedFiles.map((f) => f.path)).toEqual(["a.ts", "m.ts", "z.ts"]);
  });
});
