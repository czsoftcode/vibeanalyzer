import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
  }, 30_000); // první volání = cold load typescriptu + createProgram; na vytíženém stroji přes 5s default

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

  it("onStart dostane počet souborů a VERZI přibaleného TS", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x = 1;\n");

    let seen: { count: number; version: string } | undefined;
    await analyzeTypeScript(root, { onStart: (count, version) => { seen = { count, version }; } });
    expect(seen?.count).toBe(1);
    expect(seen?.version).toMatch(/^\d+\.\d+\.\d+/); // sémver přibaleného TS
  });

  it("chybějící node_modules → nodeModulesPresent=false a projectTsVersion undefined", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x = 1;\n");
    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.nodeModulesPresent).toBe(false);
    expect(res.projectTsVersion).toBeUndefined(); // bez projektového TS žádná poznámka
    expect(res.tsVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("ZUBY: hostile node_modules/typescript se NESPUSTÍ – jen přečteme jeho verzi", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), "export const x = 1;\n");
    const tsDir = path.join(root, "node_modules", "typescript");
    await mkdir(path.join(tsDir, "lib"), { recursive: true });
    const marker = path.join(root, "HOSTILE_EXECUTED");
    await writeFile(
      path.join(tsDir, "package.json"),
      JSON.stringify({ name: "typescript", version: "9.9.9-hostile", main: "lib/typescript.js" }),
    );
    // kdyby se tenhle modul VYHODNOTIL (require), zapíše marker = spuštění cizího kódu
    await writeFile(path.join(tsDir, "lib", "typescript.js"), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); module.exports = {};`);

    const res = await analyzeTypeScript(root);

    // 1) cizí TS se NEVYKONAL (marker nevznikl) – non-goal č. 1
    await expect(access(marker)).rejects.toThrow();
    // 2) typovalo se PŘIBALENÝM TS, ne hostile verzí
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.tsVersion).not.toBe("9.9.9-hostile");
    expect(res.tsVersion).toMatch(/^\d+\.\d+\.\d+/);
    // 3) ale jeho verzi jsme PŘEČETLI z package.json (data) a rozdíl přiznáme
    expect(res.projectTsVersion).toBe("9.9.9-hostile");
  });

  it("projektová verze TS SHODNÁ s přibalenou → projectTsVersion undefined (žádná zbytečná poznámka)", async () => {
    const root = await tmp();
    const tsmod = (await import("typescript")) as { default?: { version: string }; version?: string };
    const bundled = (tsmod.default ?? tsmod).version as string;
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), "export const x = 1;\n");
    const tsDir = path.join(root, "node_modules", "typescript");
    await mkdir(tsDir, { recursive: true });
    await writeFile(path.join(tsDir, "package.json"), JSON.stringify({ name: "typescript", version: bundled }));

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.tsVersion).toBe(bundled);
    expect(res.projectTsVersion).toBeUndefined();
  });
});
