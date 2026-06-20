import assert from "node:assert";
import { describe, expect, it } from "vitest";
import type { AuditResult } from "../audit.js";
import { buildMarkdown, type MarkdownInput } from "./markdown.js";

const base: MarkdownInput = {
  root: "/proj",
  generatedAt: "2026-06-19T00:00:00Z",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce auditu: tři rozlišitelné stavy", () => {
  it("chybějící audit → přeskočeno s výchozím důvodem (audit nevyžádán)", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## Strojové nálezy (závislosti)");
    expect(md).toContain("Audit závislostí přeskočen");
    expect(md).toContain("--audit");
    expect(md).toContain("- Závislosti: přeskočeno");
  });

  it("skipped nese KONKRÉTNÍ důvod (ne tiché 'čisto')", () => {
    const audit: AuditResult = { kind: "skipped", reason: "není package-lock.json" };
    const md = buildMarkdown({ ...base, audit });
    expect(md).toContain("není package-lock.json");
  });

  it("ran s 0 nálezy → 'čistý', ne 'přeskočeno'", () => {
    const audit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 },
      findings: [],
    };
    const md = buildMarkdown({ ...base, audit });
    expect(md).toContain("_Žádné zranitelné závislosti._");
    expect(md).toContain("- Závislosti: čistý (0 nálezů)");
    expect(md).not.toContain("Audit závislostí přeskočen");
  });

  it("ran s nálezy → vypíše odrážku s místem a souhrn počtů", () => {
    const audit: AuditResult = {
      kind: "ran",
      counts: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 },
      findings: [
        { source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-35jh-r3h4-6jhm", message: "lodash@<4.17.21 – Command Injection (závažnost: high); oprava: ano" },
      ],
    };
    const md = buildMarkdown({ ...base, audit });
    expect(md).toContain("- Závislosti: 1 nálezů");
    expect(md).toContain("`package-lock.json`");
    expect(md).toContain("GHSA-35jh-r3h4-6jhm");
    expect(md).toContain("vysokých 1");
  });

  it("info > 0 → rozpis ukáže info a součet kategorií sedí s total", () => {
    const audit: AuditResult = {
      kind: "ran",
      counts: { critical: 1, high: 1, moderate: 1, low: 1, info: 1, total: 5 },
      findings: [
        { source: "audit", severity: "error", file: "package-lock.json", rule: "GHSA-xxxx", message: "neco" },
      ],
    };
    const md = buildMarkdown({ ...base, audit });

    // 1) info je v rozpisu vidět
    expect(md).toContain("informativních 1");

    // 2) zuby: z vykreslené věty vytáhni VŠECH PĚT čísel a ověř, že jejich
    //    součet sedí s deklarovaným total (ne jen substring "info").
    const m = md.match(
      /našel (\d+) zranitelností \(kritických (\d+), vysokých (\d+), středních (\d+), nízkých (\d+), informativních (\d+)\)/,
    );
    assert(m);
    const [, total, critical, high, moderate, low, info] = m.map(Number);
    assert(
      total !== undefined &&
        critical !== undefined &&
        high !== undefined &&
        moderate !== undefined &&
        low !== undefined &&
        info !== undefined,
    );
    expect(critical + high + moderate + low + info).toBe(total);
    expect(total).toBe(5);
    expect(info).toBe(1);
  });
});
