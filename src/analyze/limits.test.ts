import { describe, expect, it } from "vitest";
import { availableMemoryBytes, computeMemoryLimitMb, MEMORY_CEILING_MB, MEMORY_FLOOR_MB, MEMORY_PERCENT } from "./limits.js";

const MB = 1024 * 1024;

describe("computeMemoryLimitMb", () => {
  it("vezme MEMORY_PERCENT z dostupné paměti (mezi podlahou a stropem)", () => {
    // 4 GB dostupných, 70 % = ~2867 MB – v rozsahu, takže projde beze clampu
    const avail = 4096 * MB;
    const expected = Math.floor(4096 * MEMORY_PERCENT);
    expect(computeMemoryLimitMb(avail)).toBe(expected);
    expect(expected).toBeGreaterThan(MEMORY_FLOOR_MB);
    expect(expected).toBeLessThan(MEMORY_CEILING_MB);
  });

  it("clampuje na PODLAHU, když je dostupné paměti málo", () => {
    // 512 MB dostupných → 70 % = ~358 MB, ale nesmíme jít pod podlahu
    expect(computeMemoryLimitMb(512 * MB)).toBe(MEMORY_FLOOR_MB);
    expect(computeMemoryLimitMb(0)).toBe(MEMORY_FLOOR_MB);
  });

  it("clampuje na STROP, když je dostupné paměti hodně", () => {
    // 64 GB dostupných → 70 % = ~45 GB, ale strop drží
    expect(computeMemoryLimitMb(64 * 1024 * MB)).toBe(MEMORY_CEILING_MB);
  });

  it("podlaha < strop (sanity konstant)", () => {
    expect(MEMORY_FLOOR_MB).toBeLessThan(MEMORY_CEILING_MB);
  });
});

describe("availableMemoryBytes", () => {
  it("vrátí kladné konečné číslo (větev process.availableMemory)", () => {
    const b = availableMemoryBytes();
    expect(Number.isFinite(b)).toBe(true);
    expect(b).toBeGreaterThan(0);
  });

  it("fallback na os.freemem(), když process.availableMemory chybí (Node 20/21)", () => {
    const orig = (process as { availableMemory?: () => number }).availableMemory;
    try {
      // simulujeme starší Node, kde funkce není
      (process as { availableMemory?: () => number }).availableMemory = undefined;
      const b = availableMemoryBytes();
      expect(Number.isFinite(b)).toBe(true);
      expect(b).toBeGreaterThan(0);
    } finally {
      (process as { availableMemory?: () => number }).availableMemory = orig;
    }
  });
});
