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

  it("ZUBY (fáze 28): import mimo kořen NEvtáhne obsah – jen TS2307, žádný cizí marker", async () => {
    // zdrojový soubor UVNITŘ root importuje soubor MIMO root. Na STARÉM kódu
    // (default host) by resolver ../secret.ts přečetl, zanalyzoval a jeho chyba
    // (Cannot find name <MARKER>) by se s cizí cestou objevila v reportu.
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    // unikátní marker: pokud se secret.ts přečte, message nálezu ho bude obsahovat
    await writeFile(path.join(outer, "secret.ts"), "export const leak = NONEXISTENT_SECRET_IDENTIFIER;\n");
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" }, files: ["a.ts"] }),
    );
    await writeFile(path.join(root, "a.ts"), 'import { leak } from "../secret";\nexport const y = leak;\n');

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // 1) obsah cizího souboru se NEVTÁHL (marker se nikde v hláškách neobjeví)
    expect(res.findings.some((f) => f.message.includes("NONEXISTENT_SECRET_IDENTIFIER"))).toBe(false);
    // 2) žádný nález nemíří na cizí soubor/cestu ven
    expect(res.findings.some((f) => f.file?.includes("secret"))).toBe(false);
    expect(res.findings.some((f) => f.file?.includes(".."))).toBe(false);
    // 3) selhání je HLUČNÉ, ne tiché: resolver vrátí TS2307 (cannot find module)
    expect(res.findings.some((f) => f.rule === "TS2307")).toBe(true);
  }, 30_000);

  it("ZUBY (fáze 28): /// <reference path> mimo kořen NEvtáhne obsah", async () => {
    // triple-slash reference je druhý vektor (modulový resolver ho míjí) – musí
    // ho zadržet gate na ČTENÍ souboru. Referencovaný soubor má unikátní marker.
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(outer, "refsecret.ts"), "const REF_LEAK = ALSO_NONEXISTENT_REF_IDENTIFIER;\n");
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), '/// <reference path="../refsecret.ts" />\nexport const x = 1;\n');

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // obsah referencovaného souboru se nevtáhl: jeho chyba (marker) se neobjeví
    expect(res.findings.some((f) => f.message.includes("ALSO_NONEXISTENT_REF_IDENTIFIER"))).toBe(false);
    expect(res.findings.some((f) => f.file?.includes("refsecret"))).toBe(false);
    expect(res.findings.some((f) => f.file?.includes(".."))).toBe(false);
    // POZITIVNÍ signál zablokování (zuby proti tichému leaku, viz N1 self-review):
    // gate vrátil "neexistuje" → TS6053 "File not found". Bez tohohle assertu by
    // BEZCHYBNÝ cizí soubor mohl být tiše přečten a test by prošel zeleně.
    expect(res.findings.some((f) => f.rule === "TS6053")).toBe(true);
  }, 30_000);

  it("ZUBY (fáze 28, SYMLINK import): symlink uvnitř root mířící VEN se NEpřečte – jen TS2307", async () => {
    // ROZDÍL od testu na :243: tam je import LITERÁLNĚ "../secret" (chytí už isUnderRoot
    // bez realpathu). Tady je importovaná cesta "./link" LITERÁLNĚ uvnitř root, ale link.ts
    // je symlink mířící VEN. Zadrží to JEN realpath v allowed() (tsc.ts:226). Mutace
    // isUnderRootRealSync→isUnderRoot tenhle test shodí, zatímco ostatní zůstanou zelené.
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    // marker: kdyby se obsah symlinku přečetl, TS ohlásí "Cannot find name <MARKER>"
    await writeFile(path.join(outer, "secret.ts"), "export const leak = SYMLINK_IMPORT_LEAK_MARKER;\n");
    // link.ts LEŽÍ uvnitř root, realpath ale míří VEN na secret.ts
    await symlink(path.join(outer, "secret.ts"), path.join(root, "link.ts"));
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" }, files: ["a.ts"] }),
    );
    await writeFile(path.join(root, "a.ts"), 'import { leak } from "./link";\nexport const y = leak;\n');

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // obsah za symlinkem se NEVTÁHL (marker se nikde v hláškách neobjeví)
    expect(res.findings.some((f) => f.message.includes("SYMLINK_IMPORT_LEAK_MARKER"))).toBe(false);
    // POZITIVNÍ signál: gate vrátil "modul neexistuje" → TS2307 (ne tichý průchod)
    expect(res.findings.some((f) => f.rule === "TS2307")).toBe(true);
  }, 30_000);

  it("ZUBY (fáze 28, SYMLINK reference): /// <reference path> na symlink ven se NEpřečte", async () => {
    // druhý vektor (triple-slash reference míjí modulový resolver) přes symlink:
    // referencovaná cesta je literálně uvnitř root, ale symlink míří ven. Opět zadrží
    // jen realpath v sync gate containedCompilerHost.
    const outer = await tmp();
    const root = path.join(outer, "proj");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(outer, "refsecret.ts"), "const REF = SYMLINK_REF_LEAK_MARKER;\n");
    await symlink(path.join(outer, "refsecret.ts"), path.join(root, "reflink.ts"));
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["a.ts"] }));
    await writeFile(path.join(root, "a.ts"), '/// <reference path="./reflink.ts" />\nexport const x = 1;\n');

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => f.message.includes("SYMLINK_REF_LEAK_MARKER"))).toBe(false);
    // POZITIVNÍ signál: gate vrátil "neexistuje" → TS6053 "File not found"
    expect(res.findings.some((f) => f.rule === "TS6053")).toBe(true);
  }, 30_000);

  // --- hoisted node_modules detekce (fáze 32) ---
  // Probe je injektovatelný (deterministický, BEZ reálného FS výš): vrací true jen pro
  // adresáře v `trueDirs` a loguje pořadí dotazů, ať jde ověřit i short-circuit a dojezd
  // k FS root. analyzeTypeScript musí proběhnout (ran), aby pole vzniklo → minimální projekt.
  async function ranWithProbe(trueDirs: (root: string) => string[]): Promise<{ res: Awaited<ReturnType<typeof analyzeTypeScript>>; queried: string[]; root: string }> {
    const root = await tmp();
    await writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ files: ["ok.ts"] }));
    await writeFile(path.join(root, "ok.ts"), "export const x = 1;\n");
    const allow = new Set(trueDirs(root));
    const queried: string[] = [];
    const res = await analyzeTypeScript(root, {
      hasNodeModulesDir: async (dir) => {
        queried.push(dir);
        return allow.has(dir);
      },
    });
    return { res, queried, root };
  }

  it("hoisted: kořen bez node_modules, předek má → hoistedNodeModules=true", async () => {
    const { res } = await ranWithProbe((root) => [path.dirname(root)]); // přímý rodič má node_modules
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.nodeModulesPresent).toBe(false);
    expect(res.hoistedNodeModules).toBe(true);
  }, 30_000);

  it("ne-hoisted: node_modules nikde (ani výš) → hoistedNodeModules=false", async () => {
    const { res } = await ranWithProbe(() => []); // probe vždy false
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.nodeModulesPresent).toBe(false);
    expect(res.hoistedNodeModules).toBe(false);
  }, 30_000);

  it("ZUBY: kořen MÁ node_modules → hoisted=false a walk se VŮBEC nespustí (jen dotaz na kořen)", async () => {
    // short-circuit: kdyby walk běžel i s lokálními node_modules, queried by mělo víc položek
    const { res, queried, root } = await ranWithProbe((r) => [r]); // node_modules přímo v kořeni
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.nodeModulesPresent).toBe(true);
    expect(res.hoistedNodeModules).toBe(false);
    expect(queried).toEqual([root]); // POUZE kořen – žádný předek se nedotazoval
  }, 30_000);

  it("ZUBY: walk dojede až k FS root a tam zastaví (node_modules je jen v kořeni FS)", async () => {
    const fsRoot = path.parse(await tmp()).root; // "/" na Linuxu
    const { res, queried } = await ranWithProbe(() => [fsRoot]); // node_modules až úplně nahoře
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.hoistedNodeModules).toBe(true);
    expect(queried).toContain(fsRoot); // walk se dostal až k FS root
    // a nezacyklil se: FS root je dotázán právě jednou (zastávka dirname(p)===p)
    expect(queried.filter((d) => d === fsRoot)).toHaveLength(1);
  }, 30_000);

  it("zdravý projekt (relativní importy + lib Promise/Array) typuje BEZ falešných chyb", async () => {
    // ověření, že gate nerozbil legitimní cesty: import uvnitř root se resolvuje
    // a lib.es*.d.ts (Promise/Array – MIMO root, v přibaleném TS) se načte.
    const root = await tmp();
    await writeFile(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler" }, files: ["a.ts", "b.ts"] }),
    );
    await writeFile(path.join(root, "b.ts"), "export const nums: number[] = [1, 2, 3];\n");
    await writeFile(
      path.join(root, "a.ts"),
      'import { nums } from "./b";\nexport async function f(): Promise<number> {\n  return nums.length;\n}\n',
    );

    const res = await analyzeTypeScript(root);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    // žádné falešné "cannot find module" (relativní import uvnitř root prošel)
    expect(res.findings.some((f) => f.rule === "TS2307")).toBe(false);
    // žádné chybějící lib typy (kdyby gate zablokoval lib: TS2318/TS2583/TS2468 …)
    expect(res.findings.some((f) => /Cannot find (global type|name) 'Promise'|'Array'/.test(f.message))).toBe(false);
    // čistý kód → 0 nálezů (kdyby cokoli z výše selhalo, sem by to spadlo)
    expect(res.findings).toHaveLength(0);
  }, 30_000);
});
