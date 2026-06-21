import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_KEY_ENV, AI_PROVIDERS } from "./analyze/aiStatus.js";
import { estimateAiCost } from "./analyze/aiEstimate.js";
import type { ChunkedPayload } from "./analyze/aiPayload.js";
import { AI_COST_CONFIRM_THRESHOLD_USD, run } from "./cli.js";

// Brána odhadu ceny PŘED AI během: nad prahem ($0.50, porovnává se REALISTICKÝ odhad
// costTypicalUsd, ne worst-case) se v TTY ptáme, jinak (ne-TTY bez --ai-yes) čistě přeskočíme.
// Pod prahem AI běží bez dotazu. U opusu je typical == strop (16000 tok.), takže opus se chová
// stejně jako dřív: dvourežimový (--ai-non-goal --ai-code) ~$0.80 > práh → spustí bránu;
// jednorežimový ~$0.40 < práh → bránu mine. Změna se projeví u glm (viz vlastní describe níž).
process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-aicost-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv(AI_PROVIDERS.glm.keyEnv, ""); // hermetičnost (viz cli.ai.test.ts)
  vi.stubEnv(AI_KEY_ENV, "sk-ant-test-key"); // klíč přítomen ve všech těchto testech
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

interface AiStatusShape {
  kind: string;
  reason?: string;
}

async function readAi(outDir: string): Promise<{ nonGoal: AiStatusShape; code: AiStatusShape; logic: AiStatusShape }> {
  const files = await readdir(outDir);
  const jsonName = files.find((f) => f.endsWith(".json"));
  expect(jsonName).toBeDefined();
  const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
  return index.ai;
}

/** Projekt s non-goaly (aby --ai-non-goal reálně volal analyze). */
async function writeProject(): Promise<void> {
  await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");
  await writeFile(path.join(proj, "project.md"), "## What I'm building\nCLI.\n\n## Non-goals\n- Do not run code.\n", "utf8");
}

const okAnalyze = () =>
  vi.fn(async () => ({ rawText: JSON.stringify({ findings: [] }), usage: { inputTokens: 100, outputTokens: 10 }, stopReason: "end_turn" }));

// Hranice, na které stojí e2e testy níž (1 režim opus pod prahem, 2 nad), je tady
// otestovaná PŘÍMO proti reálné estimateAiCost + reálné konstantě prahu. Porovnáváme TÉŽ pole,
// které čte brána (costTypicalUsd), ne worst-case – jinak by se kontrakt rozešel s realitou.
// Bez toho by refaktor ceníku/stropu/prahu mohl hranici tiše posunout a e2e testy zmást.
describe("hranice prahu vs reálný odhad (kontrakt mezi estimateAiCost a prahem)", () => {
  const tiny: ChunkedPayload = { chunks: [{ text: "export const x = 1;\n", includedFiles: [] }], oversizedFiles: [] };

  it("1 režim opus na malém vstupu je POD prahem (běh bez dotazu)", () => {
    expect(estimateAiCost(tiny, "opus", 1).costTypicalUsd).toBeLessThanOrEqual(AI_COST_CONFIRM_THRESHOLD_USD);
  });

  it("2 režimy opus jsou NAD prahem (spustí bránu)", () => {
    expect(estimateAiCost(tiny, "opus", 2).costTypicalUsd).toBeGreaterThan(AI_COST_CONFIRM_THRESHOLD_USD);
  });

  it("BUG-FIX todo 20: 1 režim glm na malém vstupu je realisticky POD prahem, ale worst-case NAD (proč brána dřív cinkala vždy)", () => {
    const e = estimateAiCost(tiny, "glm", 1);
    expect(e.costTypicalUsd).toBeLessThanOrEqual(AI_COST_CONFIRM_THRESHOLD_USD);
    expect(e.costMaxUsd).toBeGreaterThan(AI_COST_CONFIRM_THRESHOLD_USD); // kdyby brána četla tohle, ptala by se i tady
  });
});

describe("run – brána odhadu ceny před AI během", () => {
  it("(a) pod prahem (1 režim opus) → běží bez dotazu, ask se nezavolá", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ne"); // i kdyby řekl ne, nesmí být dotázán
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledOnce();
    expect((await readAi(outDir)).code.kind).toBe("analyzed");
  });

  it("(b) nad prahem + TTY + 'ano' → AI běží (analyze 2×)", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ano");
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledOnce();
    expect(analyze).toHaveBeenCalledTimes(2);
    const ai = await readAi(outDir);
    expect(ai.nonGoal.kind).toBe("analyzed");
    expect(ai.code.kind).toBe("analyzed");
  });

  it("(c) nad prahem + TTY + 'ne' → přeskočeno, analyze se nezavolá, exit 0", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ne");
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
    const ai = await readAi(outDir);
    expect(ai.nonGoal.kind).toBe("skipped");
    expect(ai.code.kind).toBe("skipped");
    expect(ai.nonGoal.reason).toContain("nepotvrzen");
  });

  it("(d) nad prahem + TTY + EOF (ask → null) → přeskočeno (default NE), analyze se nezavolá", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => null); // EOF / Ctrl-D
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledOnce();
    expect(analyze).not.toHaveBeenCalled();
    expect((await readAi(outDir)).code.kind).toBe("skipped");
  });

  it("(e) nad prahem + ne-TTY bez vlajky → přeskočeno s důvodem o --ai-yes, ask se NEspustí, exit 0", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ano"); // i kdyby řekl ano: ne-TTY = neptáme se
    const outDir = path.join(proj, "report");

    // isInteractive vynecháno (= false) → ne-TTY větev
    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    const ai = await readAi(outDir);
    expect(ai.nonGoal.kind).toBe("skipped");
    expect(ai.nonGoal.reason).toContain("--ai-yes");
    expect(ai.nonGoal.reason).toContain("interaktivní");
  });

  it("(f) --ai-yes nad prahem → běží bez dotazu i v TTY", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ne");
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-non-goal", "--ai-code", "--ai-yes"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled();
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it("odhad se VŽDY vypíše na stderr (i pod prahem)", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const outDir = path.join(proj, "report");
    await run([proj, "--out", outDir, "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask: vi.fn(async () => "ano"),
    });
    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("Odhad ceny AI");
    expect(errs).toContain("NE fakturace");
  });
});

// Jádro fáze 55 / todo 20: u glm brána dřív cinkala VŽDY (worst-case strop 131072 tok. ≈ $0.58 >
// práh i s nulovým vstupem). Teď gateuje realistický odhad → malý glm projekt projde bez dotazu,
// velký (kde dominuje VSTUPNÍ cena) bránu pořád spustí. Tyhle dva testy mají zuby: kdyby se brána
// vrátila na costMaxUsd, (g) by selhal (ask by se zavolal a analyze ne).
describe("run – glm brána na realistickém odhadu (todo 20)", () => {
  beforeEach(() => {
    vi.stubEnv(AI_PROVIDERS.glm.keyEnv, "zai-test-key"); // glm klíč přítomen
  });

  it("(g) glm 3 režimy na malém projektu → běží BEZ dotazu (ask se nevolá), analyze 3×", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ne"); // i kdyby řekl ne, nesmí být dotázán
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-model", "glm", "--ai-non-goal", "--ai-code", "--ai-logic"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).not.toHaveBeenCalled(); // dřív (gate na costMaxUsd) by se ZEPTAL → tady jsou zuby
    expect(analyze).toHaveBeenCalledTimes(3);
    expect((await readAi(outDir)).code.kind).toBe("analyzed");
  });

  it("(h) glm velký vstup → brána se PŘESTO spustí (přes vstupní složku ceny), TTY 'ano' → analyze běží", async () => {
    await writeLargeProject();
    const analyze = okAnalyze();
    const ask = vi.fn(async () => "ano");
    const outDir = path.join(proj, "report");

    const code = await run([proj, "--out", outDir, "--ai-model", "glm", "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask,
    });
    expect(code).toBe(0);
    expect(ask).toHaveBeenCalledOnce(); // velký vstup = realistický odhad nad prahem i bez worst-case
    expect(analyze.mock.calls.length).toBeGreaterThan(1); // velký projekt = víc částí = víc volání
    expect((await readAi(outDir)).code.kind).toBe("analyzed");
  });
});

interface ChunkMetaShape {
  total: number;
  failed: number;
  reasons: string[];
}

/** Plný `ai` objekt z JSON reportu (včetně metadat krájení/oversizedFiles). */
async function readAiRaw(outDir: string): Promise<{ chunking?: { code?: ChunkMetaShape }; oversizedFiles?: string[]; code: AiStatusShape }> {
  const files = await readdir(outDir);
  const jsonName = files.find((f) => f.endsWith(".json"));
  expect(jsonName).toBeDefined();
  const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
  return index.ai;
}

/**
 * Projekt, který reálně PŘETÉKÁ jednu část (okno 0,75×1,65M ≈ 1,24M znaků) → krájí se na
 * víc částí. 20 souborů po ~90 kB (pod per-file stropem 100 kB) = ~1,8M znaků → ≥2 části.
 * Bez tsconfig (tsc se přeskočí, ať test netrvá věčnost). Obsah je validní TS.
 */
async function writeSizedProject(fileCount: number): Promise<void> {
  const line = "export const padding_value_for_size = 1234567890;\n"; // ~50 B
  const big = line.repeat(1800); // ~90 kB, pod per-file stropem 100 kB
  for (let i = 0; i < fileCount; i++) {
    await writeFile(path.join(proj, `big${i}.ts`), big, "utf8");
  }
  await writeFile(path.join(proj, "project.md"), "## What I'm building\nCLI.\n\n## Non-goals\n- Do not run code.\n", "utf8");
}

/** ~1,8M znaků (20 × ~90 kB) → spolehlivě víc částí (i s plným oknem ≥2). */
async function writeLargeProject(): Promise<void> {
  await writeSizedProject(20);
}

describe("run – krájený AI běh: chunking do reportu", () => {
  it("velký projekt → rozkrájí se na víc částí, analyze běží per část, JSON nese ai.chunking", async () => {
    await writeLargeProject();
    const analyze = okAnalyze();
    const outDir = path.join(proj, "report");
    // --ai-yes obejde cenovou bránu (velký vstup = jistě nad prahem) → běhová větev.
    const code = await run([proj, "--out", outDir, "--ai-code", "--ai-yes"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask: vi.fn(async () => "ano"),
    });
    expect(code).toBe(0);
    // ~1,8M znaků / okno ~1,24M = ≥2 části → analyze volán per část (ne jednou).
    expect(analyze.mock.calls.length).toBeGreaterThan(1);
    const ai = await readAiRaw(outDir);
    expect(ai.code.kind).toBe("analyzed"); // sloučeno z částí
    expect(ai.chunking?.code?.total).toBeGreaterThan(1); // přiznán počet částí
    expect(ai.chunking?.code?.failed).toBe(0); // všechny části prošly (okAnalyze)
    // počet volání analyze == počet částí (každá část = jedno volání)
    expect(analyze.mock.calls.length).toBe(ai.chunking?.code?.total);
  });

  it("okno se reálně plní jen na 75 %: projekt mezi 75% a 100% okna → 2 části (s plným oknem by byl 1)", async () => {
    // ~1,37M znaků: NAD 75% oknem (floor(1,65M×0,75)=1,2375M → 2 části), ale POD plným
    // oknem (1,65M → 1 část). Zub na CHUNK_FILL_RATIO: kdyby cli použilo plné okno místo
    // 75 %, vyšla by 1 část a total by nebyl 2.
    await writeSizedProject(15);
    const analyze = okAnalyze();
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-code", "--ai-yes"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask: vi.fn(async () => "ano"),
    });
    expect(code).toBe(0);
    const ai = await readAiRaw(outDir);
    expect(ai.chunking?.code?.total).toBe(2); // s plným oknem (mutace bez ratio) by bylo 1
    expect(analyze).toHaveBeenCalledTimes(2);
  });

  it("malý projekt → 1 část, analyze 1×, chunking total=1, failed=0", async () => {
    await writeProject();
    const analyze = okAnalyze();
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-code"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
      isInteractive: true,
      ask: vi.fn(async () => "ano"),
    });
    expect(code).toBe(0);
    expect(analyze).toHaveBeenCalledOnce();
    const ai = await readAiRaw(outDir);
    expect(ai.chunking?.code).toEqual({ total: 1, failed: 0, reasons: [] });
  });

  it("část selže provozně (analyze hodí známou chybu) → report přizná chunkFailed + důvod, exit 0", async () => {
    await writeLargeProject();
    // analyze vždy hodí síťovou chybu, classify ji ZNÁ → každá část skipped (provozní).
    const analyze = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-code", "--ai-yes"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => "síťová chyba (zkus později)",
      isInteractive: true,
      ask: vi.fn(async () => "ano"),
    });
    expect(code).toBe(0); // čistá degradace, ne pád
    const ai = await readAiRaw(outDir);
    expect(ai.code.kind).toBe("skipped"); // 0 částí analyzed → skipped
    expect(ai.chunking?.code?.failed).toBeGreaterThan(0); // přiznán počet selhaných
    expect(ai.chunking?.code?.failed).toBe(ai.chunking?.code?.total); // všechny selhaly
    expect(ai.chunking?.code?.reasons.join(" ")).toContain("síťová");
  });
});
