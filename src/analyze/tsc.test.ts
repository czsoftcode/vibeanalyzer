import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
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

  it("ZUBY (SEC-1 vektor 1): files mimo kořen se NEANALYZUJE – vynecháno + hlučný nález", async () => {
    // soubor MIMO root (o úroveň výš); na STARÉM kódu by ho tsc zařadil a zanalyzoval
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    // záměrná typová chyba: kdyby se secret.ts analyzoval, vznikl by TS2322 s cestou ../
    await writeFile(path.join(outer, "secret.ts"), 'export const secret: number = "x";\n');
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["../secret.ts", "ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x: number = 1;\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // jen legitimní soubor uvnitř (STARÝ kód: 2)
    expect(res.fileCount).toBe(1);
    // vnější soubor se NEzanalyzoval → žádný jeho nález ani cesta ven (STARÝ kód: TS2322 z secret)
    expect(res.findings.some((f) => f.rule === "TS2322")).toBe(false);
    expect(res.findings.some((f) => f.file?.includes(".."))).toBe(false);
    // pokus je hlučně OHLÁŠEN
    const warn = res.findings.find((f) => f.severity === "warning" && /mimo kořen/.test(f.message));
    expect(warn).toBeDefined();
    expect(warn?.message).toContain("secret.ts");
  }, 30_000);

  it("všechny soubory mimo kořen → skipped s PRAVDIVÝM důvodem (ne 'prázdný projekt')", async () => {
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(outer, "secret.ts"), "export const x = 1;\n");
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["../secret.ts"] }));

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("mimo kořen");
    expect(res.reason).not.toContain("žádné soubory"); // nelhat "prázdný projekt"
  }, 30_000);

  it("ZUBY (SEC-1 vektor 1, symlink): soubor uvnitř symlinkovaný VEN se NEANALYZUJE", async () => {
    // symlink obejde literální test cesty – realpath ho musí rozplést
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    // záměrná typová chyba: kdyby se cizí soubor přečetl, vznikl by TS2322
    await writeFile(path.join(outer, "secret.ts"), 'export const secret: number = "x";\n');
    // link.ts LEŽÍ uvnitř root, ale míří VEN
    await symlink(path.join(outer, "secret.ts"), path.join(root, "link.ts"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["link.ts", "ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x: number = 1;\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // STARÝ kód (jen literál): fileCount=2 a TS2322 z cizího souboru
    expect(res.fileCount).toBe(1);
    expect(res.findings.some((f) => f.rule === "TS2322")).toBe(false);
    const warn = res.findings.find((f) => f.severity === "warning" && /mimo kořen/.test(f.message));
    expect(warn).toBeDefined();
  }, 30_000);

  it("ZUBY (SEC-1 vektor 2): extends mimo kořen se NEPŘEČTE – jeho options se neuplatní a je ohlášeno", async () => {
    // base config LEŽÍ MIMO root a zapíná noUnusedLocals; na STARÉM kódu by se přečetl
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(outer, "base.json"), JSON.stringify({ compilerOptions: { noUnusedLocals: true } }));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ extends: "../base.json", files: ["a.ts"] }));
    // nepoužitá lokální proměnná → TS6133 JEN když by se noUnusedLocals z extends uplatnil
    await writeFile(path.join(root, "a.ts"), "export function f(): number { const unused = 1; return 2; }\n");

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // extends mimo root se NEuplatnil → žádné TS6133 (na STARÉM kódu by tu bylo)
    expect(res.findings.some((f) => f.rule === "TS6133")).toBe(false);
    // a pokus je OHLÁŠEN: TS hlásí nenačtený extends jako chybu konfigurace
    expect(res.findings.some((f) => f.rule === "TS5083")).toBe(true);
  }, 30_000);

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
