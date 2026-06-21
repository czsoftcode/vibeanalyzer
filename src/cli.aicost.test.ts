import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_KEY_ENV, AI_PROVIDERS } from "./analyze/aiStatus.js";
import { estimateAiCost } from "./analyze/aiEstimate.js";
import type { AiPayload } from "./analyze/aiPayload.js";
import { AI_COST_CONFIRM_THRESHOLD_USD, run } from "./cli.js";

// Brána odhadu ceny PŘED AI během: nad prahem ($0.50, porovnává se worst-case) se v TTY
// ptáme, jinak (ne-TTY bez --ai-yes) čistě přeskočíme. Pod prahem AI běží bez dotazu.
// Dvourežimový běh na opusu (--ai-non-goal --ai-code) má worst-case ~$0.80 > práh →
// spolehlivě bránu spustí; jednorežimový opus má ~$0.40 < práh → bránu mine.
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
// otestovaná PŘÍMO proti reálné estimateAiCost + reálné konstantě prahu. Bez toho by
// refaktor ceníku/stropu/prahu mohl hranici tiše posunout a e2e testy zmást.
describe("hranice prahu vs reálný odhad (kontrakt mezi estimateAiCost a prahem)", () => {
  const tiny: AiPayload = { text: "export const x = 1;\n", includedFiles: [], truncated: false, oversizedFiles: [] };

  it("1 režim opus na malém vstupu je POD prahem (běh bez dotazu)", () => {
    expect(estimateAiCost(tiny, "opus", 1).costMaxUsd).toBeLessThanOrEqual(AI_COST_CONFIRM_THRESHOLD_USD);
  });

  it("2 režimy opus jsou NAD prahem (spustí bránu)", () => {
    expect(estimateAiCost(tiny, "opus", 2).costMaxUsd).toBeGreaterThan(AI_COST_CONFIRM_THRESHOLD_USD);
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
