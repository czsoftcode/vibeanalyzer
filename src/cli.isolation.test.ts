import { describe, expect, it, vi } from "vitest";
import { skipFromOutcome } from "./cli.js";
import { ANALYSIS_TIMEOUT_MS } from "./analyze/limits.js";

// Kontrakt „důvod nelže": tři příčiny neúspěchu izolovaného běhu (OOM / timeout /
// obecný pád) se MUSÍ promítnout do TŘÍ odlišných skip důvodů. Reálný OOM/timeout
// nejde v testu věrně vyrobit, proto testujeme mapování přímo na IsolatedOutcome.

describe("skipFromOutcome", () => {
  it("ok → null (použij hodnotu z dítěte)", () => {
    expect(skipFromOutcome({ kind: "ok", value: 1 }, "tsc", 1024)).toBeNull();
  });

  it("oom → skipped s důvodem o velikosti a konkrétním limitem MB", () => {
    const r = skipFromOutcome({ kind: "oom" }, "tsc", 2048);
    expect(r).toEqual({ kind: "skipped", reason: expect.stringContaining("příliš velký") });
    expect(r?.reason).toContain("2048 MB");
    expect(r?.reason).toContain("tsc");
  });

  it("timeout → skipped s důvodem o čase a konkrétním limitem v sekundách", () => {
    const r = skipFromOutcome({ kind: "timeout" }, "ESLint", 1024);
    expect(r?.reason).toContain("příliš dlouho");
    expect(r?.reason).toContain(`${Math.round(ANALYSIS_TIMEOUT_MS / 1000)} s`);
    expect(r?.reason).toContain("ESLint");
  });

  it("crashed → skipped (NE velikost/čas) a stderr se vypíše se stackem", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = skipFromOutcome({ kind: "crashed", detail: "stack: boom" }, "tsc", 1024);
    expect(r?.reason).toContain("selhal");
    // klíčové: NEsmí lhát „příliš velký"/„příliš dlouho"
    expect(r?.reason).not.toContain("příliš velký");
    expect(r?.reason).not.toContain("příliš dlouho");
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining("stack: boom"));
    errSpy.mockRestore();
  });

  it("tři příčiny dají tři ODLIŠNÉ důvody (neslévají se)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {}); // crashed větev jinak píše na stderr
    const oom = skipFromOutcome({ kind: "oom" }, "tsc", 1024)?.reason;
    const to = skipFromOutcome({ kind: "timeout" }, "tsc", 1024)?.reason;
    const cr = skipFromOutcome({ kind: "crashed", detail: "x" }, "tsc", 1024)?.reason;
    expect(new Set([oom, to, cr]).size).toBe(3);
  });
});
