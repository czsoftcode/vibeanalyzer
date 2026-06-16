import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTENT_HEADINGS, loadIntent, parseIntent } from "./intent.js";

// Reálný fixtur ve formátu, jaký generuje `mini init` – kontrakt s mini.
// NEpíšeme jen ručně podaný mock dvou nadpisů: parser musí umět přeskočit
// ostatní sekce (Who/Approach/Success/Constraints) a zastavit se na dalším `##`.
const MINI_FIXTURE = `# DemoProjekt

## What I'm building
Lokální CLI nástroj.
Druhý řádek záměru.

## Who it's for
Vibekodeři

## Approach
- něco

## Non-goals
- Do not run code.
- Do not build a web service.

## Success criteria
- Proběhne bez pádu.

## Main constraints
Typescript
`;

describe("parseIntent – kontrakt s formátem mini", () => {
  it("vytáhne víceřádkový záměr a non-goaly jako seznam", () => {
    const intent = parseIntent(MINI_FIXTURE, "/x/project.md");
    expect(intent.building).toBe("Lokální CLI nástroj.\nDruhý řádek záměru.");
    expect(intent.nonGoals).toEqual(["Do not run code.", "Do not build a web service."]);
    expect(intent.sourcePath).toBe("/x/project.md");
  });

  it("ignoruje ostatní sekce a zastaví se na dalším nadpisu", () => {
    const intent = parseIntent(MINI_FIXTURE, "/x");
    // záměr nesmí přetéct do "Who it's for"
    expect(intent.building).not.toContain("Vibekodeři");
    // non-goaly nesmí spolknout "Success criteria"
    expect(intent.nonGoals).not.toContain("Proběhne bez pádu.");
  });

  it("chybějící sekce → null (ne prázdný string)", () => {
    const intent = parseIntent("# Jen titulek\n\nžádné sekce\n", "/x");
    expect(intent.building).toBeNull();
    expect(intent.nonGoals).toBeNull();
  });

  it("přítomná, ale prázdná sekce → null", () => {
    const content = `## ${INTENT_HEADINGS.building}\n\n## ${INTENT_HEADINGS.nonGoals}\n`;
    const intent = parseIntent(content, "/x");
    expect(intent.building).toBeNull();
    expect(intent.nonGoals).toBeNull();
  });

  it("non-goaly bez položek seznamu (jen text) → null", () => {
    const content = `## ${INTENT_HEADINGS.nonGoals}\njen odstavec bez odrážek\n`;
    const intent = parseIntent(content, "/x");
    expect(intent.nonGoals).toBeNull();
  });

  it("4-1: řádek '# ...' v próze sekci neuřízne", () => {
    const content = [
      "## What I'm building",
      "CLI nástroj. Příklad spuštění:",
      "# vibeanalyzer ./src",
      "Pak projde strom.",
      "## Non-goals",
      "- x",
    ].join("\n");
    const intent = parseIntent(content, "/x");
    // celý text včetně '#' řádku zůstane; nesmí se uříznout na prvním '#'
    expect(intent.building).toContain("# vibeanalyzer ./src");
    expect(intent.building).toContain("Pak projde strom.");
  });

  it("4-3: nadpis a odrážky uvnitř code fence se neberou jako struktura", () => {
    const content = [
      "## What I'm building",
      "Skutečný úvod.",
      "```",
      "## Non-goals", // uvnitř bloku – NESMÍ ukončit sekci ani být brán jako nadpis
      "- falešný non-goal z ukázky",
      "```",
      "Skutečná próza za blokem.",
      "",
      "## Non-goals",
      "- skutečný non-goal",
    ].join("\n");
    const intent = parseIntent(content, "/x");
    // próza za fenced blokem se neztratila (sekce neskončila na nadpisu v bloku)
    expect(intent.building).toContain("Skutečná próza za blokem.");
    // a non-goaly obsahují jen skutečnou položku, ne tu z ukázky
    expect(intent.nonGoals).toEqual(["skutečný non-goal"]);
  });
});

describe("loadIntent – lokalizace souboru", () => {
  let proj: string;

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-intent-"));
  });

  afterEach(async () => {
    await rm(proj, { recursive: true, force: true }).catch(() => {});
  });

  it("přednostně načte .mini/project.md", async () => {
    await mkdir(path.join(proj, ".mini"), { recursive: true });
    await writeFile(path.join(proj, ".mini", "project.md"), MINI_FIXTURE, "utf8");
    // i fallback existuje – nesmí se použít
    await writeFile(path.join(proj, "project.md"), "## What I'm building\nfallback\n", "utf8");

    const r = await loadIntent(proj);
    expect(r.kind).toBe("loaded");
    if (r.kind === "loaded") {
      expect(r.intent.building).toContain("Lokální CLI nástroj.");
      expect(r.intent.sourcePath).toBe(path.join(proj, ".mini", "project.md"));
    }
  });

  it("když .mini/project.md není, spadne na fallback project.md", async () => {
    await writeFile(path.join(proj, "project.md"), "## What I'm building\nfallback záměr\n", "utf8");
    const r = await loadIntent(proj);
    expect(r.kind).toBe("loaded");
    if (r.kind === "loaded") {
      expect(r.intent.building).toBe("fallback záměr");
      expect(r.intent.sourcePath).toBe(path.join(proj, "project.md"));
    }
  });

  it("žádný kandidát → absent", async () => {
    const r = await loadIntent(proj);
    expect(r.kind).toBe("absent");
  });

  it("kandidát existuje, ale nejde přečíst (je to adresář) → unreadable", async () => {
    // project.md jako ADRESÁŘ → readFile hodí EISDIR; deterministické i pod rootem
    await mkdir(path.join(proj, "project.md"), { recursive: true });
    const r = await loadIntent(proj);
    expect(r.kind).toBe("unreadable");
    if (r.kind === "unreadable") {
      expect(r.path).toBe(path.join(proj, "project.md"));
      expect(r.code).toBe("EISDIR");
    }
  });
});
