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
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: false, dev: false, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("vezme cestu jako pozicní argument, výstup zůstává výchozí", () => {
    const r = parseArgs(["./sub"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./sub"), outDir: null, audit: false, dev: false, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("--out přepíše výstupní adresář", () => {
    const r = parseArgs(["./sub", "--out", "/tmp/out"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./sub"), outDir: "/tmp/out", audit: false, dev: false, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("--out= varianta funguje taky", () => {
    const r = parseArgs(["--out=/tmp/out", "x"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "x"), outDir: "/tmp/out", audit: false, dev: false, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("--out= s prázdnou hodnotou je chyba (ne tichý zápis do CWD)", () => {
    const r = parseArgs(["x", "--out="], cwd);
    expect(r).toEqual({ kind: "error", message: "Volba --out vyžaduje cestu k adresáři." });
  });

  it("--audit zapne audit, dev zůstává vypnuté", () => {
    const r = parseArgs(["--audit"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: true, dev: false, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("--audit --dev zapne obojí", () => {
    const r = parseArgs(["--audit", "--dev", "./p"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: path.resolve(cwd, "./p"), outDir: null, audit: true, dev: true, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
  });

  it("samotné --dev (bez --audit) se zaznamená, ale audit zůstává vypnutý", () => {
    const r = parseArgs(["--dev"], cwd);
    expect(r).toEqual({ kind: "run", targetPath: cwd, outDir: null, audit: false, dev: true, aiCheck: false, aiNonGoal: false, aiCode: false, aiModel: "opus" });
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
      aiNonGoal: false, aiCode: false,
      aiModel: "opus",
    });
  });

  it("bez --ai-check zůstává aiCheck false (default běh neutrácí za API)", () => {
    const r = parseArgs([], cwd);
    expect(r.kind === "run" && r.aiCheck).toBe(false);
  });

  it("--ai-non-goal zapne analýzu non-goalů, model default opus", () => {
    const r = parseArgs(["--ai-non-goal", "./p"], cwd);
    expect(r.kind === "run" && r.aiNonGoal).toBe(true);
    expect(r.kind === "run" && r.aiCode).toBe(false);
    expect(r.kind === "run" && r.aiModel).toBe("opus");
  });

  it("--ai-code zapne analýzu kódu nezávisle na non-goalech", () => {
    const r = parseArgs(["--ai-code", "./p"], cwd);
    expect(r.kind === "run" && r.aiCode).toBe(true);
    expect(r.kind === "run" && r.aiNonGoal).toBe(false);
  });

  it("--ai-non-goal a --ai-code lze zapnout naráz (každý vlastní dotaz)", () => {
    const r = parseArgs(["--ai-non-goal", "--ai-code", "./p"], cwd);
    expect(r.kind === "run" && r.aiNonGoal).toBe(true);
    expect(r.kind === "run" && r.aiCode).toBe(true);
  });

  it("starý --ai už neexistuje (je to neznámá volba)", () => {
    const r = parseArgs(["--ai", "./p"], cwd);
    expect(r.kind).toBe("error");
  });

  it("--ai-model sonnet přepne model (dvouargumentová forma)", () => {
    const r = parseArgs(["--ai-non-goal", "--ai-model", "sonnet"], cwd);
    expect(r.kind === "run" && r.aiModel).toBe("sonnet");
  });

  it("--ai-model=sonnet funguje taky", () => {
    const r = parseArgs(["--ai-code", "--ai-model=sonnet"], cwd);
    expect(r.kind === "run" && r.aiModel).toBe("sonnet");
  });

  it("--ai-model bez hodnoty je chyba", () => {
    const r = parseArgs(["--ai-non-goal", "--ai-model"], cwd);
    expect(r.kind).toBe("error");
  });

  it("--ai-model s neznámým modelem je chyba", () => {
    const r = parseArgs(["--ai-non-goal", "--ai-model", "gpt"], cwd);
    expect(r.kind).toBe("error");
    if (r.kind === "error") expect(r.message).toContain("opus | sonnet");
  });

  it("default běh: aiNonGoal i aiCode false (default neutrácí za drahou analýzu)", () => {
    const r = parseArgs([], cwd);
    expect(r.kind === "run" && r.aiNonGoal).toBe(false);
    expect(r.kind === "run" && r.aiCode).toBe(false);
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
