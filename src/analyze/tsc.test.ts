import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeTypeScript } from "./tsc.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "vibe-tsc-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

describe("analyzeTypeScript", () => {
  it("úmyslná typová chyba → nález na správném souboru a řádku", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["bad.ts"] }));
    // chyba je na 2. řádku (1. řádek je komentář)
    await writeFile(path.join(root, "bad.ts"), "// pozn\nconst x: number = \"tohle není číslo\";\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    const hit = res.findings.find((f) => f.rule === "TS2322");
    expect(hit).toBeDefined();
    expect(hit?.file).toBe("bad.ts");
    expect(hit?.line).toBe(2);
    expect(hit?.severity).toBe("error");
    expect(res.fileCount).toBe(1);
  });

  it("čistý projekt → ran s 0 nálezy (NE skipped)", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x: number = 1;\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings).toHaveLength(0);
  });

  it("bez tsconfig → skipped, ne pád", async () => {
    const root = await tmp();
    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("tsconfig");
  });

  it("chyba konfigurace (extends na neexistující soubor) se OBJEVÍ jako nález, ne tiché 0", async () => {
    // regrese nálezu 1: cmd.errors se dřív zahodily, když byl zahrnut aspoň jeden soubor
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ extends: "./neexistuje.json", files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), "export const x = 1;\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => f.rule === "TS5083")).toBe(true);
  });

  it("neznámá volba v tsconfigu se objeví jako nález", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { nesmysl: true }, files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), "export const x = 1;\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => f.rule === "TS5023")).toBe(true);
  });

  it("prázdný tsconfig (žádné soubory) → skipped s PRAVDIVÝM důvodem, ne 'chyba konfigurace'", async () => {
    // regrese nálezu 3: TS18003 ("no inputs") se nesmí vydávat za chybu configu
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), "{}");
    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("žádné soubory");
    expect(res.reason).not.toContain("chyba konfigurace");
  });

  it("rozbitý tsconfig (neplatný JSON) → skipped, ne pád", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), "{ tohle není : validní json ");
    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("naparsovat");
  });

  it("onStart dostane počet souborů a zdroj tsc", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x = 1;\n");

    let seen: { count: number; src: string } | undefined;
    await analyzeTypeScript(root, { onStart: (count, src) => { seen = { count, src }; } });
    expect(seen).toEqual({ count: 1, src: "bundled" });
  });

  it("chybějící node_modules se promítne do nodeModulesPresent=false", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x = 1;\n");
    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.nodeModulesPresent).toBe(false);
  });
});
