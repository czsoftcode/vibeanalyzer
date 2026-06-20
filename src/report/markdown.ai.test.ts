import { describe, expect, it } from "vitest";
import { AI_KEY_ENV, detectAiStatus } from "../analyze/aiStatus.js";
import { buildMarkdown, type MarkdownInput } from "./markdown.js";

const base: MarkdownInput = {
  root: "/proj",
  generatedAt: "2026-06-20T00:00:00Z",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce AI vrstvy: dva rozlišitelné stavy", () => {
  it("chybějící ai (undefined) → přeskočeno s výchozím důvodem", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## AI analýza (logika a non-goaly)");
    expect(md).toContain("AI přeskočeno:");
    expect(md).toContain("- AI (logika a non-goaly): přeskočeno");
  });

  it("bez klíče (reálný detectAiStatus) → 'AI přeskočeno: chybí ANTHROPIC_API_KEY'", () => {
    // Kontrakt mezi moduly: text reportu skládáme z REÁLNÉHO výstupu detekce,
    // ne z ručně zadaného důvodu – kdyby se důvod v aiStatus.ts změnil, test padne.
    const md = buildMarkdown({ ...base, ai: detectAiStatus({}) });
    expect(md).toContain("AI přeskočeno: chybí ANTHROPIC_API_KEY");
    expect(md).toContain("- AI (logika a non-goaly): přeskočeno");
  });

  it("s klíčem (reálný detectAiStatus) → připraveno, ne falešné 'hotovo'", () => {
    const md = buildMarkdown({ ...base, ai: detectAiStatus({ [AI_KEY_ENV]: "sk-ant-xxx" }) });
    expect(md).toContain("AI připraveno (klíč nalezen, dotaz zatím neproběhl)");
    expect(md).toContain("- AI (logika a non-goaly): připraveno");
    expect(md).not.toContain("AI přeskočeno");
  });

  it("verified → 'AI ověřeno' a souhrn 'ověřeno' (ne 'připraveno', ne 'přeskočeno')", () => {
    const md = buildMarkdown({ ...base, ai: { kind: "verified" } });
    expect(md).toContain("AI ověřeno (testovací dotaz na API proběhl");
    expect(md).toContain("- AI (logika a non-goaly): ověřeno");
    expect(md).not.toContain("AI připraveno");
    expect(md).not.toContain("AI přeskočeno");
  });

  it("hodnota klíče se NIKDY neobjeví v reportu (tajemství)", () => {
    const md = buildMarkdown({ ...base, ai: detectAiStatus({ [AI_KEY_ENV]: "sk-ant-super-secret" }) });
    expect(md).not.toContain("super-secret");
  });
});
