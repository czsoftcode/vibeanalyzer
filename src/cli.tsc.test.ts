import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";
import type { TscResult } from "./findings.js";

describe("run – tsc vrstva v reportu", () => {
  let proj: string;
  let outDir: string;
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-tsc-"));
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

  async function readReport(): Promise<{ md: string; json: { tsc: TscResult } }> {
    const outFiles = await readdir(outDir);
    const mdName = outFiles.find((f) => f.endsWith(".md"));
    const jsonName = outFiles.find((f) => f.endsWith(".json"));
    const md = await readFile(path.join(outDir, mdName as string), "utf8");
    const json = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
    return { md, json };
  }

  it("e2e: úmyslná typová chyba se objeví v reportu na správném řádku, exit 0", async () => {
    await writeFile(path.join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true }, files: ["bad.ts"] }));
    await writeFile(path.join(proj, "bad.ts"), "// pozn\nexport const x: number = \"ne\";\n");

    const code = await run([proj, "--out", outDir], proj);
    expect(code).toBe(0); // nálezy v cizím projektu NEMĚNÍ exit kód

    const { md, json } = await readReport();
    expect(md).toContain("`bad.ts:2");
    expect(md).toContain("TS2322");
    expect(json.tsc.kind).toBe("ran");
  });

  it("injected skipped projde 1:1 do md i JSON", async () => {
    await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n");
    const fakeSkip = async (): Promise<TscResult> => ({ kind: "skipped", reason: "test-skip-důvod" });

    const code = await run([proj, "--out", outDir], proj, { analyzeTs: fakeSkip });
    expect(code).toBe(0);

    const { md, json } = await readReport();
    expect(md).toContain("_tsc přeskočeno: test-skip-důvod_");
    expect(json.tsc).toEqual({ kind: "skipped", reason: "test-skip-důvod" });
  });

  it("výjimka z analyzátoru NESHODÍ běh: exit 0, varování na stderr, vrstva přeskočena", async () => {
    await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n");
    const boom = async (): Promise<TscResult> => {
      throw new Error("rozbitý analyzátor");
    };

    const code = await run([proj, "--out", outDir], proj, { analyzeTs: boom });
    expect(code).toBe(0);
    expect(errors.some((e) => e.includes("typová analýza (tsc) selhala") && e.includes("rozbitý analyzátor"))).toBe(true);

    const { md } = await readReport();
    expect(md).toContain("_tsc přeskočeno:");
  });
});
