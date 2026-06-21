import { describe, expect, it, vi } from "vitest";
import { runChunkedMode } from "./aiChunkedRun.js";
import type { AiChunk } from "./aiPayload.js";
import type { AiModelChoice, AiStatus } from "./aiStatus.js";
import type { Finding } from "../findings.js";

// Reálné tvary (ne vymyšlený literál): AiChunk, AiStatus, Finding podle skutečných typů.
function chunk(tag: string): AiChunk {
  return { text: `// ==== ${tag} ====\nkód`, includedFiles: [{ path: `${tag}.ts`, lineCount: 1 }] };
}
function finding(message: string): Finding {
  return { source: "ai", severity: "warning", message };
}
function analyzed(
  findings: Finding[],
  inputTokens: number,
  outputTokens: number,
  costUsd: number,
  model: AiModelChoice = "opus",
): AiStatus {
  return { kind: "analyzed", model, findings, usage: { inputTokens, outputTokens }, costUsd };
}
function skipped(reason: string): AiStatus {
  return { kind: "skipped", reason };
}

describe("runChunkedMode – slučování běhu přes části", () => {
  it("víc analyzed částí → sečte usage/cenu a spojí nálezy v pořadí částí", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const results = [
      analyzed([finding("n1")], 10, 20, 0.1),
      analyzed([finding("n2")], 30, 40, 0.2),
      analyzed([finding("n3")], 50, 60, 0.3),
    ];
    const out = await runChunkedMode(chunks, async (_c, i) => results[i]!);

    expect(out.status.kind).toBe("analyzed");
    if (out.status.kind !== "analyzed") throw new Error("nedosažitelné");
    expect(out.status.findings.map((f) => f.message)).toEqual(["n1", "n2", "n3"]); // pořadí částí
    expect(out.status.usage).toEqual({ inputTokens: 90, outputTokens: 120 }); // součet
    expect(out.status.costUsd).toBeCloseTo(0.6, 10);
    expect(out.status.model).toBe("opus");
    expect(out).toMatchObject({ chunkTotal: 3, chunkFailed: 0, failureReasons: [] });
  });

  it("runOne dostane každou část s jejím indexem, sekvenčně", async () => {
    const chunks = [chunk("a"), chunk("b")];
    const seen: number[] = [];
    await runChunkedMode(chunks, async (c, i) => {
      seen.push(i);
      expect(c).toBe(chunks[i]); // správná část na správném indexu
      return analyzed([], 1, 1, 0);
    });
    expect(seen).toEqual([0, 1]);
  });

  it("provozně přeskočená část se NEzahodí: posbírá zbytek, přizná chunkFailed + reason", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const results = [analyzed([finding("n1")], 10, 10, 0.1), skipped("API přetížené (529)"), analyzed([finding("n3")], 5, 5, 0.05)];
    const out = await runChunkedMode(chunks, async (_c, i) => results[i]!);

    expect(out.status.kind).toBe("analyzed");
    if (out.status.kind !== "analyzed") throw new Error("nedosažitelné");
    expect(out.status.findings.map((f) => f.message)).toEqual(["n1", "n3"]); // jen z analyzed
    expect(out.status.usage).toEqual({ inputTokens: 15, outputTokens: 15 }); // bez skipnuté
    expect(out.chunkTotal).toBe(3);
    expect(out.chunkFailed).toBe(1);
    expect(out.failureReasons).toEqual(["API přetížené (529)"]);
  });

  it("model se vezme z PRVNÍ analyzed části (ne z pozdější)", async () => {
    const chunks = [chunk("a"), chunk("b")];
    const results = [analyzed([], 1, 1, 0, "glm"), analyzed([], 1, 1, 0, "opus")];
    const out = await runChunkedMode(chunks, async (_c, i) => results[i]!);
    expect(out.status.kind === "analyzed" && out.status.model).toBe("glm");
  });

  it("VŠECHNY části skipped se stejným důvodem → status skipped s tím důvodem", async () => {
    const chunks = [chunk("a"), chunk("b")];
    const out = await runChunkedMode(chunks, async () => skipped("chybí klíč pro model opus"));
    expect(out.status).toEqual({ kind: "skipped", reason: "chybí klíč pro model opus" });
    expect(out).toMatchObject({ chunkTotal: 2, chunkFailed: 2 });
    expect(out.failureReasons).toEqual(["chybí klíč pro model opus", "chybí klíč pro model opus"]);
  });

  it("VŠECHNY skipped s RŮZNÝMI důvody → souhrn spojí unikátní důvody", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const reasons = ["timeout", "API přetížené (529)", "timeout"];
    const out = await runChunkedMode(chunks, async (_c, i) => skipped(reasons[i]!));
    expect(out.status.kind).toBe("skipped");
    if (out.status.kind !== "skipped") throw new Error("nedosažitelné");
    expect(out.status.reason).toContain("timeout");
    expect(out.status.reason).toContain("API přetížené (529)");
    expect(out.chunkFailed).toBe(3);
  });

  it("neočekávaný stav (ready) z runOne → počítá se do chunkFailed, NE do failureReasons", async () => {
    // ready/verified by v analytickém běhu neměly nastat; když přece, část se nezapočítá
    // do nálezů, ale chunkFailed (= total − analyzed) ji zahrne, kdežto failureReasons ne
    // (nemá reason). Tím se chunkFailed a failureReasons.length VĚDOMĚ rozejdou.
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const results: AiStatus[] = [analyzed([finding("n1")], 7, 8, 0.05), { kind: "ready" }, skipped("timeout")];
    const out = await runChunkedMode(chunks, async (_c, i) => results[i]!);

    expect(out.status.kind).toBe("analyzed");
    if (out.status.kind !== "analyzed") throw new Error("nedosažitelné");
    expect(out.status.findings.map((f) => f.message)).toEqual(["n1"]); // ready nic nepřidá
    expect(out.status.usage).toEqual({ inputTokens: 7, outputTokens: 8 }); // jen z analyzed
    expect(out.chunkFailed).toBe(2); // ready + skipped, NE failureReasons.length (=1)
    expect(out.failureReasons).toEqual(["timeout"]); // jen skipped nese reason
    expect(out.chunkFailed).toBeGreaterThan(out.failureReasons.length); // rozejití zafixováno
  });

  it("prázdné chunks → skipped, počty 0, žádné důvody (bez pádu)", async () => {
    const runOne = vi.fn(async () => analyzed([], 1, 1, 1));
    const out = await runChunkedMode([], runOne);
    expect(out).toEqual({
      status: { kind: "skipped", reason: "žádné zdrojové soubory k analýze" },
      chunkTotal: 0,
      chunkFailed: 0,
      failureReasons: [],
    });
    expect(runOne).not.toHaveBeenCalled(); // žádná část = žádné volání
  });

  it("PROGRAMOVÁ chyba z runOne probublá (rethrow), nemaskuje se jako přeskočení", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const runOne = vi.fn(async (_c: AiChunk, i: number): Promise<AiStatus> => {
      if (i === 1) throw new TypeError("boom");
      return analyzed([], 1, 1, 0);
    });
    await expect(runChunkedMode(chunks, runOne)).rejects.toThrow(TypeError);
    await expect(runChunkedMode(chunks, runOne)).rejects.toThrow("boom");
  });

  it("po probublané chybě se další části UŽ nevolají (sekvenční přerušení)", async () => {
    const chunks = [chunk("a"), chunk("b"), chunk("c")];
    const runOne = vi.fn(async (_c: AiChunk, i: number): Promise<AiStatus> => {
      if (i === 1) throw new Error("stop");
      return analyzed([], 1, 1, 0);
    });
    await expect(runChunkedMode(chunks, runOne)).rejects.toThrow("stop");
    expect(runOne).toHaveBeenCalledTimes(2); // index 0 a 1; index 2 už ne
  });
});
