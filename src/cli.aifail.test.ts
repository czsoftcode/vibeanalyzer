import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_KEY_ENV, AI_PROVIDERS } from "./analyze/aiStatus.js";
import { run } from "./cli.js";

// REGRESE (fáze 61): runAiLayer obaluje try/catchem NEJEN čtení souborů (splitAiPayload),
// ale i SETUP – dynamické importy SDK/orchestrátoru (cli.ts). Když selže import (rozbitý
// build, chybějící .js), má vrstva degradovat na skipped stejně jako u TOCTOU čtení, ne
// shodit celé CLI (exit 1, žádný report). Tady selhání importu SIMULUJEME: aiChunkedRun.js
// se při importu rozbije (vi.mock factory throw). Catch je REÁLNÝ kód cli.ts – mock jen
// vyrobí chybový stav, jako chmod 000 vyrobí EACCES. Odebrání catche → run() rejectne a
// test spadne (zuby). vi.mock je file-scoped, proto SAMOSTATNÝ soubor (nepošpiní cli.ai.test).
vi.mock("./analyze/aiChunkedRun.js", () => {
  throw new Error("simulované selhání importu aiChunkedRun.js");
});

process.env.VIBE_ANALYSIS_INPROCESS = "1";

let proj: string;

beforeEach(async () => {
  proj = await mkdtemp(path.join(tmpdir(), "vibe-cli-aifail-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv(AI_PROVIDERS.glm.keyEnv, ""); // hermetičnost: žádný alt klíč z prostředí
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(proj, { recursive: true, force: true }).catch(() => {});
});

describe("run – selhání dynamického importu AI setupu degraduje, neshodí CLI", () => {
  it("import aiChunkedRun.js hodí → AI režim skipped, strojový report se vyrobí, exit 0", async () => {
    vi.stubEnv(AI_KEY_ENV, "sk-ant-key");
    await writeFile(path.join(proj, "a.ts"), "export const x = 1;\n", "utf8");

    // Injektujeme aiAnalyzeFn + classify, ať se import aiAnalyze.js/aiPing.js přeskočí a
    // pád izolujeme na aiChunkedRun.js. analyze se stejně nesmí zavolat (pád je PŘED během).
    const analyze = vi.fn(async () => ({ rawText: "{}", usage: { inputTokens: 0, outputTokens: 0 }, stopReason: "end_turn" }));
    const outDir = path.join(proj, "report");
    const code = await run([proj, "--out", outDir, "--ai-non-goal"], proj, {
      aiAnalyzeFn: analyze,
      aiClassifyFn: () => null,
    });

    expect(code).toBe(0); // selhání setupu AI vrstvy NESMÍ shodit běh
    expect(analyze).not.toHaveBeenCalled();

    const files = await readdir(outDir);
    const jsonName = files.find((f) => f.endsWith(".json"));
    expect(jsonName).toBeDefined();
    const index = JSON.parse(await readFile(path.join(outDir, jsonName as string), "utf8"));
    expect(index.ai.nonGoal.kind).toBe("skipped");
    expect(index.ai.nonGoal.reason).toContain("viz stderr");
    expect(index.ai.code).toEqual({ kind: "ready" }); // nevyžádaný režim zůstal ready (pre)
    expect(index.tsc).toBeDefined(); // strojová vrstva přežila

    const errs = vi.mocked(console.error).mock.calls.map((c) => String(c[0])).join("\n");
    expect(errs).toContain("AI vrstva selhala nečekaně");
  });
});
