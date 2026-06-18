import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FileEntry } from "../scan.js";
import { analyzeESLint } from "./eslint.js";
import { LINTABLE_EXTENSIONS } from "./eslintConfig.js";

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(tmpdir(), "vibe-eslint-"));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

function file(p: string, ext: string): FileEntry {
  return { path: p, type: "file", ext, size: 1, depth: 1 };
}

describe("analyzeESLint", () => {
  it("porušené pravidlo (==) → nález na správném souboru a řádku", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "bad.js"), "// pozn\nif (1 == 1) {}\n");

    const res = await analyzeESLint(root, [file("bad.js", ".js")]);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    const hit = res.findings.find((f) => f.rule === "eqeqeq");
    expect(hit).toBeDefined();
    expect(hit?.file).toBe("bad.js");
    expect(hit?.line).toBe(2);
    expect(hit?.severity).toBe("error");
  });

  it("prázdný catch (no-empty) se chytí i na .ts", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "a.ts"), "export function f(): void {\n  try { f(); } catch (e) {}\n}\n");

    const res = await analyzeESLint(root, [file("a.ts", ".ts")]);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => f.rule === "no-empty")).toBe(true);
  });

  it("čistý soubor → ran s 0 nálezy (NE skipped)", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "ok.js"), "export const x = 1;\n");
    const res = await analyzeESLint(root, [file("ok.js", ".js")]);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings).toHaveLength(0);
  });

  it("žádné JS/TS soubory → skipped", async () => {
    const root = await tmp();
    const res = await analyzeESLint(root, [file("README.md", ".md"), { path: "src", type: "dir", ext: "", size: 0, depth: 1 }]);
    expect(res.kind).toBe("skipped");
    if (res.kind !== "skipped") return;
    expect(res.reason).toContain("JS/TS");
  });

  it("BEZPEČNOST: projektový eslint.config.js se NESPUSTÍ", async () => {
    const root = await tmp();
    // kdyby ESLint načetl tenhle config, jeho vyhodnocení by HODILO → nedostali
    // bychom čisté nálezy. overrideConfigFile:true ho ani nehledá.
    await writeFile(path.join(root, "eslint.config.js"), "throw new Error('config se spustil – non-goal porušen');\n");
    await writeFile(path.join(root, "bad.js"), "if (1 == 1) {}\n");

    const res = await analyzeESLint(root, [file("bad.js", ".js"), file("eslint.config.js", ".js")]);
    // projel náš config (eqeqeq), žádný throw z jejich configu
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => f.rule === "eqeqeq")).toBe(true);
  });

  it("onStart dostane počet souborů", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "ok.js"), "export const x = 1;\n");
    let seen: number | undefined;
    await analyzeESLint(root, [file("ok.js", ".js")], { onStart: (n) => { seen = n; } });
    expect(seen).toBe(1);
  });

  it("KONTRAKT: každá LINTABLE_EXTENSIONS má v configu glob (žádný 'no matching configuration')", async () => {
    // regrese nálezu z review: kdyby se přípony v analyzátoru a configu rozešly,
    // soubor by dostal fatal "File ignored because no matching configuration"
    // jako falešný "error" nález. Projedeme reálně každou příponu.
    const root = await tmp();
    const entries: FileEntry[] = [];
    let i = 0;
    for (const ext of LINTABLE_EXTENSIONS) {
      const name = `f${i++}${ext}`;
      await writeFile(path.join(root, name), "export const x = 1;\n");
      entries.push(file(name, ext));
    }
    const res = await analyzeESLint(root, entries);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => /no matching configuration/i.test(f.message))).toBe(false);
  });

  it("nepoužitá eslint-disable direktiva cizího projektu se NEHLÁSÍ", async () => {
    const root = await tmp();
    // no-undef není v našem rulesetu → tahle direktiva je vůči nám "nepoužitá"
    await writeFile(path.join(root, "a.js"), "// eslint-disable-next-line no-undef\nexport const x = 1;\n");
    const res = await analyzeESLint(root, [file("a.js", ".js")]);
    expect(res.kind).toBe("ran");
    if (res.kind !== "ran") return;
    expect(res.findings.some((f) => /disable directive/i.test(f.message))).toBe(false);
  });

  it("nezapisuje do projektu (žádný --fix, žádné nové soubory)", async () => {
    const root = await tmp();
    await writeFile(path.join(root, "bad.js"), "if (1 == 1) {}\n");
    await analyzeESLint(root, [file("bad.js", ".js")]);
    // ESLint by s fix:false neměl nic přepsat ani vytvořit; ověříme, že nevznikl
    // žádný eslint cache/output soubor
    await expect(access(path.join(root, ".eslintcache"))).rejects.toThrow();
  });
});
