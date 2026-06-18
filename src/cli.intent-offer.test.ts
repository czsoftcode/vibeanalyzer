import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "./cli.js";
import type { AskFn } from "./intentPrompt.js";
import { projectKey } from "./projectPaths.js";

/**
 * Testy interaktivní nabídky vytvoření záměru. Vše přes INJEKTOVANÉ deps
 * (fake ask + isInteractive + homeDir) – žádný reálný stdin ani reálný ~.
 */
// Necílí izolaci strojové vrstvy → in-process (bez forku, rychlé).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

describe("run – interaktivní nabídka vytvoření záměru", () => {
  let proj: string;
  let home: string;
  let outDir: string;
  let logs: string[];
  let errors: string[];

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-offer-proj-"));
    home = await mkdtemp(path.join(tmpdir(), "vibe-offer-home-"));
    outDir = path.join(proj, "report");
    await writeFile(path.join(proj, "index.ts"), "export const x = 1;\n", "utf8");
    logs = [];
    errors = [];
    vi.spyOn(console, "log").mockImplementation((m?: unknown) => void logs.push(String(m)));
    vi.spyOn(console, "error").mockImplementation((m?: unknown) => void errors.push(String(m)));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(proj, { recursive: true, force: true }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });

  /** Skriptovaný dotazovač: vydá odpovědi v pořadí, po vyčerpání null (EOF). */
  function scriptedAsk(answers: ReadonlyArray<string | null>): { ask: AskFn; questions: string[] } {
    const questions: string[] = [];
    let i = 0;
    const ask: AskFn = async (q) => {
      questions.push(q);
      return i < answers.length ? (answers[i++] ?? null) : null;
    };
    return { ask, questions };
  }

  /** Cesta k zapsanému záměru přes REÁLnou projectKey (kontrakt cesty má zuby). */
  function storeFile(): string {
    return path.join(home, ".vibeanalyzer", projectKey(proj), "project.md");
  }

  async function readReportMd(): Promise<string> {
    const outFiles = await readdir(outDir);
    const mdName = outFiles.find((f) => f.endsWith(".md"));
    expect(mdName).toBeDefined();
    return readFile(path.join(outDir, mdName as string), "utf8");
  }

  it("ano → vytvoří project.md v domově a rovnou ho použije v reportu, exit 0", async () => {
    const { ask } = scriptedAsk(["a", "Lokální CLI nástroj.", "Nespouštět kód.", ""]);
    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    expect(code).toBe(0);

    // soubor vznikl v injektovaném domově
    const written = await readFile(storeFile(), "utf8");
    expect(written).toContain("## What I'm building");
    expect(written).toContain("Lokální CLI nástroj.");
    expect(written).toContain("- Nespouštět kód.");

    // a záměr je v TOMTO reportu
    const md = await readReportMd();
    expect(md).toContain("## Záměr projektu");
    expect(md).toContain("> Lokální CLI nástroj.");
    expect(md).toContain("> - Nespouštět kód.");
  });

  it("READ-ONLY: do analyzovaného projektu se při vytvoření nic nezapíše", async () => {
    const { ask } = scriptedAsk(["a", "CLI nástroj.", ""]);
    await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    // v projektu zůstal jen index.ts a výstupní složka report/, žádný project.md
    const inProj = (await readdir(proj)).sort();
    expect(inProj).toEqual(["index.ts", "report"]);
  });

  it("odmítnutí [N] → žádný zápis, žádný sběr, padne na Tip, exit 0", async () => {
    const { ask, questions } = scriptedAsk(["n"]);
    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    expect(code).toBe(0);

    // jen potvrzovací otázka, sběr se nespustil
    expect(questions.length).toBe(1);
    await expect(readdir(path.join(home, ".vibeanalyzer"))).rejects.toMatchObject({ code: "ENOENT" });

    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
    expect(logs.some((l) => l.includes("What I'm building") && l.includes("Non-goals"))).toBe(true);
  });

  it("EOF hned po potvrzení (zrušený sběr) → žádný zápis, report bez záměru, exit 0", async () => {
    const { ask } = scriptedAsk(["a"]); // potvrdí, pak building dostane null (EOF)
    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    expect(code).toBe(0);

    await expect(readdir(path.join(home, ".vibeanalyzer"))).rejects.toMatchObject({ code: "ENOENT" });
    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
    expect(logs.some((l) => l.includes("zrušeno"))).toBe(true);
  });

  it("isInteractive=false → ani se nezeptá (gate), dnešní Tip, exit 0", async () => {
    const { ask, questions } = scriptedAsk(["a", "CLI nástroj.", ""]);
    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: false, homeDir: home });
    expect(code).toBe(0);

    expect(questions.length).toBe(0); // ask se nezavolal
    await expect(readdir(path.join(home, ".vibeanalyzer"))).rejects.toMatchObject({ code: "ENOENT" });
    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
  });

  it("neznámý domov (homeDir prázdný) → no-home, hláška, report bez záměru, exit 0", async () => {
    const { ask } = scriptedAsk(["a", "CLI nástroj.", ""]);
    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: "" });
    expect(code).toBe(0);

    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
    expect(errors.some((e) => e.includes("neznámý domovský adresář"))).toBe(true);
  });

  it("TOCTOU: soubor vznikne mezi načtením a zápisem → exists, NEpřepíše, exit 0", async () => {
    // potvrzovací dotaz (po loadIntent=absent, před zápisem) vytvoří cizí soubor
    let step = 0;
    const ask: AskFn = async () => {
      step++;
      if (step === 1) {
        await mkdir(path.dirname(storeFile()), { recursive: true });
        await writeFile(storeFile(), "CIZÍ ZÁMĚR – nesahat\n", "utf8");
        return "a";
      }
      if (step === 2) return "CLI nástroj.";
      return ""; // konec non-goalů
    };

    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    expect(code).toBe(0);
    // cizí obsah zůstal nedotčen
    expect(await readFile(storeFile(), "utf8")).toBe("CIZÍ ZÁMĚR – nesahat\n");
    expect(logs.some((l) => l.includes("už mezitím existuje"))).toBe(true);
    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
  });

  it("zápis selže (v cestě soubor místo složky) → unwritable, hláška, report vznikne, exit 0", async () => {
    // step 1 založí <key> jako SOUBOR → mkdir té složky padne (root-safe, bez práv)
    const keyDir = path.join(home, ".vibeanalyzer", projectKey(proj));
    let step = 0;
    const ask: AskFn = async () => {
      step++;
      if (step === 1) {
        await mkdir(path.dirname(keyDir), { recursive: true });
        await writeFile(keyDir, "kolize\n", "utf8");
        return "a";
      }
      if (step === 2) return "CLI nástroj.";
      return "";
    };

    const code = await run([proj, "--out", outDir], proj, { ask, isInteractive: true, homeDir: home });
    expect(code).toBe(0);
    expect(errors.some((e) => e.includes("záměr nešlo uložit"))).toBe(true);
    const md = await readReportMd();
    expect(md).toContain("_Záměr nedodán._");
  });
});
