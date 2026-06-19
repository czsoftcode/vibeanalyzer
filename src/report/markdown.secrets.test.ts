import { describe, expect, it } from "vitest";
import type { SecretsResult } from "../secrets.js";
import { buildMarkdown, type MarkdownInput } from "./markdown.js";

const base: MarkdownInput = {
  root: "/proj",
  generatedAt: "2026-06-19T00:00:00Z",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce tajemství: tři rozlišitelné stavy", () => {
  it("chybějící secrets → přeskočeno (ne tiché 'čisto')", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## Strojové nálezy (tajemství)");
    expect(md).toContain("Tajemství přeskočeno");
    expect(md).toContain("- Tajemství: přeskočeno");
  });

  it("ran s 0 nálezy → 'čistý', ne 'přeskočeno'", () => {
    const secrets: SecretsResult = { kind: "ran", fileCount: 5, findings: [] };
    const md = buildMarkdown({ ...base, secrets });
    expect(md).toContain("_Žádná tajemství nenalezena._");
    expect(md).toContain("- Tajemství: čistý (0 nálezů)");
    expect(md).not.toContain("Tajemství přeskočeno");
  });

  it("ran s nálezy → vypíše odrážku s místem, typem a maskou", () => {
    const secrets: SecretsResult = {
      kind: "ran",
      fileCount: 5,
      findings: [
        { source: "secret", severity: "error", file: ".env", line: 2, rule: "aws-access-key-id", message: "Možné tajemství (AWS Access Key ID): AKIA…(20 znaků)" },
      ],
    };
    const md = buildMarkdown({ ...base, secrets });
    expect(md).toContain("- Tajemství: 1 nálezů");
    expect(md).toContain("`.env:2`");
    expect(md).toContain("AKIA…(20 znaků)");
  });
});

describe("buildMarkdown – ÚNIK: celá hodnota tajemství se v reportu NIKDY neobjeví", () => {
  it("maskovaná zpráva projde, ale plná hodnota klíče v .md není", () => {
    const fullSecret = "AKIAIOSFODNN7EXAMPLE";
    const secrets: SecretsResult = {
      kind: "ran",
      fileCount: 1,
      findings: [
        // tak, jak ji vyrobí skener: jen maskovaný náznak
        { source: "secret", severity: "error", file: ".env", line: 1, rule: "aws-access-key-id", message: "Možné tajemství (AWS Access Key ID): AKIA…(20 znaků)" },
      ],
    };
    const md = buildMarkdown({ ...base, secrets });
    expect(md.includes(fullSecret)).toBe(false);
  });
});
