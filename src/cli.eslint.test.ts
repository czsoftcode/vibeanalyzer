import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";
import type { EslintResult } from "./findings.js";

describe("run – ESLint vrstva v reportu", () => {
  let proj: string;
  let outDir: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-eslint-"));
    outDir = path.join(proj, "report");
    errors = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
      errors.push(String(msg));
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  async function readReport(): Promise<{ md: string; json: { eslint: EslintResult } }> {
    const outFiles = await readdir(outDir);
    const md = await readFile(path.join(outDir, outFiles.find((f) => f.endsWith(".md")) as string), "utf8");
    const json = JSON.parse(await readFile(path.join(outDir, outFiles.find((f) => f.endsWith(".json")) as string), "utf8"));
    return { md, json };
  }

  it("e2e: porušené pravidlo (==) se objeví v reportu na správném řádku, exit 0", async () => {
    await writeFile(path.join(proj, "bad.js"), "// pozn\nif (1 == 1) {}\n");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0); // nálezy v cizím projektu NEMĚNÍ exit kód

    const { md, json } = await readReport();
    expect(md).toContain("`bad.js:2");
    expect(md).toContain("eqeqeq");
    expect(json.eslint.kind).toBe("ran");
  });

  it("projekt bez JS/TS souborů → ESLint přeskočeno", async () => {
    await writeFile(path.join(proj, "README.md"), "# demo\n");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0);

    const { md, json } = await readReport();
    expect(md).toContain("_ESLint přeskočeno:");
    expect(json.eslint.kind).toBe("skipped");
  });

  it("výjimka z analyzátoru NESHODÍ běh: exit 0, varování na stderr, přeskočeno", async () => {
    await writeFile(path.join(proj, "a.js"), "export const x = 1;\n");
    const boom = async (): Promise<EslintResult> => {
      throw new Error("rozbitý ESLint");
    };

    const code = await run([proj, "--out", outDir], proj, { analyzeES: boom });
    expect(code).toBe(0);
    expect(errors.some((e) => e.includes("lint analýza (ESLint) selhala") && e.includes("rozbitý ESLint"))).toBe(true);

    const { md } = await readReport();
    expect(md).toContain("_ESLint přeskočeno:");
  });
});
