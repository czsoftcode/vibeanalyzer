import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultOutDir, parseArgs, validateTarget } from "./args.js";
import { projectKey } from "./projectPaths.js";

describe("parseArgs", () => {
  const cwd = "/home/user/proj";

  it("bez argumentu bere aktuální složku a výchozí výstup (null), audit/dev vypnuté", () => {
    const r = parseArgs([], cwd);
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: false, dev: false, aiCheck: false });
  });

  it("vezme cestu jako pozicní argument, výstup zůstává výchozí", () => {
    const r = parseArgs(["./sub"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./sub"), outDir: null, audit: false, dev: false, aiCheck: false });
  });

  it("--out přepíše výstupní adresář", () => {
    const r = parseArgs(["./sub", "--out", "/tmp/out"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./sub"), outDir: "/tmp/out", audit: false, dev: false, aiCheck: false });
  });

  it("--out= varianta funguje taky", () => {
    const r = parseArgs(["--out=/tmp/out", "x"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "x"), outDir: "/tmp/out", audit: false, dev: false, aiCheck: false });
  });

  it("--out= s prázdnou hodnotou je chyba (ne tichý zápis do CWD)", () => {
    const r = parseArgs(["x", "--out="], cwd);
    expect(r).toEqual({ kind: "error", message: "Volba --out vyžaduje cestu k adresáři." });
  });

  it("--audit zapne audit, dev zůstává vypnuté", () => {
    const r = parseArgs(["--audit"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: true, dev: false, aiCheck: false });
  });

  it("--audit --dev zapne obojí", () => {
    const r = parseArgs(["--audit", "--dev", "./p"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./p"), outDir: null, audit: true, dev: true, aiCheck: false });
  });

  it("samotné --dev (bez --audit) se zaznamená, ale audit zůstává vypnutý", () => {
    const r = parseArgs(["--dev"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: false, dev: true, aiCheck: false });
  });

  it("--ai-check zapne ověření AI (opt-in), ostatní zůstává výchozí", () => {
    const r = parseArgs(["--ai-check", "./p"], cwd);
    expect(r).toEqual({
      kind: "run",
      targetPath: path.resolve(cwd, "./p"),
      outDir: null,
      audit: false,
      dev: false,
      aiCheck: true,
    });
  });

  it("bez --ai-check zůstává aiCheck false (default běh neutrácí za API)", () => {
    const r = parseArgs([], cwd);
    expect(r.kind === "run" && r.aiCheck).toBe(false);
  });

  it("--help a --version mají přednost", () => {
    expect(parseArgs(["--help"], cwd)).toEqual({ kind: "help" });
    expect(parseArgs(["-v"], cwd)).toEqual({ kind: "version" });
  });

  it("neznámá volba je chyba", () => {
    const r = parseArgs(["--nope"], cwd);
    expect(r.kind).toBe("error");
  });

  it("--out bez hodnoty je chyba", () => {
    const r = parseArgs(["--out"], cwd);
    expect(r.kind).toBe("error");
  });

  it("druhý pozicní argument je chyba", () => {
    const r = parseArgs(["a", "b"], cwd);
    expect(r.kind).toBe("error");
  });
});

describe("defaultOutDir", () => {
  it("složí ~/.vibeanalyzer/<projectKey> (sdílený klíč s intent)", () => {
    // přes reálnou projectKey, ne natvrdo zadaný hash – kdyby se defaultOutDir
    // přestal opírat o projectKey (rozpor s intent.loadIntent), test padne
    expect(defaultOutDir("/home/user", "/work/muj-projekt")).toBe(
      path.join("/home/user", ".vibeanalyzer", projectKey("/work/muj-projekt")),
    );
  });

  it("dva projekty se stejným jménem z různých cest → různý outDir (žádný přepis)", () => {
    expect(defaultOutDir("/home/user", "/a/app")).not.toBe(
      defaultOutDir("/home/user", "/b/app"),
    );
  });

  it("pro kořen / složí klíč s prefixem 'root'", () => {
    expect(defaultOutDir("/home/user", "/")).toBe(
      path.join("/home/user", ".vibeanalyzer", projectKey("/")),
    );
  });
});

describe("validateTarget", () => {
  let dir: string;
  let file: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "vibe-args-"));
    file = path.join(dir, "soubor.txt");
    await writeFile(file, "ahoj", "utf8");
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("platný adresář projde", async () => {
    expect(await validateTarget(dir)).toEqual({ ok: true });
  });

  it("neexistující cesta selže srozumitelně", async () => {
    const r = await validateTarget(path.join(dir, "neexistuje"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("neexistuje");
  });

  it("soubor (ne adresář) selže", async () => {
    const r = await validateTarget(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("není adresář");
  });
});
