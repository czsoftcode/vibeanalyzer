import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChunkedRunResult } from "./analyze/aiChunkedRun.js";
import { runOneAiMode } from "./cli.js";

// Jednotka: REÁLNÁ runOneAiMode (cli.ts) s injektovaným `call`. Hlídá KONTRAKT, že provozní
// skip s naúčtovanou cenou (max_tokens/prázdný výstup) ji přizná i na stderr, kdežto
// beznákladový skip (chybí klíč, žádné non-goaly, síť → costUsd undefined) zůstane bez ceny.
// Testuje skutečnou funkci, ne mock literál; vyříznutí render-větve test shodí (zuby).

let errors: string[];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((msg?: unknown) => {
    errors.push(String(msg));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function result(status: ChunkedRunResult["status"]): ChunkedRunResult {
  return { status, chunkTotal: 1, chunkFailed: 1, failureReasons: [] };
}

describe("runOneAiMode – cena přeskočeného AI běhu na stderr", () => {
  it("skipped s costUsd/usage (provozní skip) → stderr přizná naúčtovanou cenu i tokeny", async () => {
    const call = (): Promise<ChunkedRunResult> =>
      Promise.resolve(
        result({
          kind: "skipped",
          reason: "model utnul výstup na max_tokens",
          usage: { inputTokens: 4321, outputTokens: 128000 },
          costUsd: 1.2345,
        }),
      );
    const out = await runOneAiMode("kódu", "opus", call);

    expect(out.status.kind).toBe("skipped");
    const joined = errors.join("\n");
    expect(joined).toContain("přeskočena, ale částečně naúčtována");
    expect(joined).toContain("4321 vstup + 128000 výstup");
    expect(joined).toContain("~$1.2345");
  });

  it("skipped BEZ ceny (beznákladový skip) → na stderr se NEobjeví cenový marker '~$'", async () => {
    const call = (): Promise<ChunkedRunResult> =>
      Promise.resolve(result({ kind: "skipped", reason: "chybí ANTHROPIC_API_KEY" }));
    const out = await runOneAiMode("non-goalů", "opus", call);

    expect(out.status.kind).toBe("skipped");
    const joined = errors.join("\n");
    expect(joined).not.toContain("částečně naúčtována");
    expect(joined).not.toContain("~$");
  });
});
