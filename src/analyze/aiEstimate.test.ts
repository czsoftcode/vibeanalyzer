import { describe, expect, it } from "vitest";
import type { AiPayload } from "./aiPayload.js";
import {
  CHARS_PER_TOKEN,
  OUTPUT_MIN_TOKENS_PER_MODE,
  estimateAiCost,
  formatCostEstimate,
} from "./aiEstimate.js";

/** Payload jen s textem – ostatní pole odhad nepoužívá. */
function payload(text: string): AiPayload {
  return { text, includedFiles: [], truncated: false, omittedFiles: 0, omittedBytes: 0, oversizedFiles: [] };
}

/** Text dlouhý přesně tolik, aby dal `tokens` vstupních tokenů (ceil(len/poměr)). */
function textForTokens(tokens: number): string {
  return "x".repeat(Math.round(tokens * CHARS_PER_TOKEN));
}

describe("estimateAiCost – rozsah ceny per model a per počet režimů", () => {
  it("vstup počítá heuristikou znaky/token", () => {
    const e = estimateAiCost(payload(textForTokens(1000)), "opus", 1);
    expect(e.inputTokensPerMode).toBe(1000);
  });

  it("vstup i výstup se NÁSOBÍ počtem režimů (každý posílá celý payload)", () => {
    const one = estimateAiCost(payload(textForTokens(1000)), "opus", 1);
    const three = estimateAiCost(payload(textForTokens(1000)), "opus", 3);
    // vstup na režim stejný, ale celkové tokeny i cena 3×
    expect(three.inputTokensPerMode).toBe(one.inputTokensPerMode);
    expect(three.outputMaxTokens).toBe(one.outputMaxTokens * 3);
    expect(three.outputMinTokens).toBe(one.outputMinTokens * 3);
    expect(three.costMaxUsd).toBeCloseTo(one.costMaxUsd * 3, 6);
  });

  it("opus: konkrétní meze (ceník 5/25 za M, strop 16000)", () => {
    const e = estimateAiCost(payload(textForTokens(1000)), "opus", 1);
    // vstup 1000 tok × $5/M = $0.005; výstup min 2000 × $25/M = $0.05; max 16000 × $25/M = $0.4
    expect(e.outputMinTokens).toBe(2000);
    expect(e.outputMaxTokens).toBe(16000);
    expect(e.costMinUsd).toBeCloseTo(0.055, 6);
    expect(e.costMaxUsd).toBeCloseTo(0.405, 6);
  });

  it("glm je levnější než opus za identický vstup i počet režimů", () => {
    const opus = estimateAiCost(payload(textForTokens(5000)), "opus", 2);
    const glm = estimateAiCost(payload(textForTokens(5000)), "glm", 2);
    expect(glm.costMaxUsd).toBeLessThan(opus.costMaxUsd);
    // glm má ale VYŠŠÍ strop výstupu (65536 vs 16000) → víc výstupních tokenů
    expect(glm.outputMaxTokens).toBeGreaterThan(opus.outputMaxTokens);
  });

  it("prázdný payload: vstup 0 tokenů, žádné NaN/dělení nulou, výstup pořád ze stropu", () => {
    const e = estimateAiCost(payload(""), "opus", 1);
    expect(e.inputTokensPerMode).toBe(0);
    expect(Number.isNaN(e.costMinUsd)).toBe(false);
    expect(Number.isNaN(e.costMaxUsd)).toBe(false);
    expect(e.costMinUsd).toBeCloseTo(0.05, 6); // jen výstup min
    expect(e.costMaxUsd).toBeCloseTo(0.4, 6); // jen výstup max
  });

  it("modeCount 0: nulový odhad, bez pádu", () => {
    const e = estimateAiCost(payload(textForTokens(1000)), "glm", 0);
    expect(e.costMinUsd).toBe(0);
    expect(e.costMaxUsd).toBe(0);
    expect(e.outputMaxTokens).toBe(0);
  });

  it("OUTPUT_MIN_TOKENS_PER_MODE je nenulový (i levný běh stojí thinking + JSON)", () => {
    expect(OUTPUT_MIN_TOKENS_PER_MODE).toBeGreaterThan(0);
  });
});

describe("formatCostEstimate – rozsah, ne jedno číslo", () => {
  it("vypíše obě meze a explicitně přizná, že jde o odhad, ne fakturaci", () => {
    const e = estimateAiCost(payload(textForTokens(1000)), "glm", 3);
    const out = formatCostEstimate(e, "glm");
    expect(out).toContain("PŘIBLIŽNÝ");
    expect(out).toContain("NE fakturace");
    expect(out).toContain("až nejvýš");
    expect(out).toContain("glm");
    expect(out).toContain("3×");
  });
});
