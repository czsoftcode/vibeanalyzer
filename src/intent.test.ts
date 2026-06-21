import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INTENT_HEADINGS, loadIntent, parseIntent } from "./intent.js";
import { projectKey } from "./projectPaths.js";

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

describe("parseIntent – context (syrový project.md bez non-goalů)", () => {
  it("kontext drží záměr i ostatní sekce, ale NE sekci Non-goals", () => {
    const intent = parseIntent(MINI_FIXTURE, "/x");
    // sekce, které AI dřív nedostávala, jsou v kontextu
    expect(intent.context).toContain("## What I'm building");
    expect(intent.context).toContain("Lokální CLI nástroj.");
    expect(intent.context).toContain("## Approach");
    expect(intent.context).toContain("## Success criteria");
    expect(intent.context).toContain("## Main constraints");
    // ZUB: non-goaly se z kontextu vyřezaly (jdou do promptu jako číslovaný seznam).
    // Kdyby vyříznutí přestalo fungovat, tahle dvojice padne.
    expect(intent.context).not.toContain("## Non-goals");
    expect(intent.context).not.toContain("Do not run code.");
    expect(intent.context).not.toContain("Do not build a web service.");
  });

  it("'## Non-goals' UVNITŘ code fence se nevyřezává (jen skutečná sekce zmizí)", () => {
    const content = [
      "## What I'm building",
      "Úvod.",
      "```",
      "## Non-goals", // ukázka v bloku – musí v kontextu zůstat
      "- ukázkový non-goal",
      "```",
      "Próza za blokem.",
      "",
      "## Non-goals",
      "- skutečný non-goal",
    ].join("\n");
    const intent = parseIntent(content, "/x");
    // skutečná sekce (poslední) je pryč i s položkou
    expect(intent.context).not.toContain("skutečný non-goal");
    // ale ukázka uvnitř fence i próza za ním zůstaly
    expect(intent.context).toContain("## Non-goals"); // ta z fence
    expect(intent.context).toContain("ukázkový non-goal");
    expect(intent.context).toContain("Próza za blokem.");
  });

  it("minimální project.md (jen záměr) → kontext = celý text (degraduje na dnešek)", () => {
    const content = "## What I'm building\nStavím malý CLI.\n";
    const intent = parseIntent(content, "/x");
    expect(intent.context).toContain("Stavím malý CLI.");
  });

  it("prázdný obsah → kontext null (ne prázdný string)", () => {
    expect(parseIntent("", "/x").context).toBeNull();
    expect(parseIntent("   \n\n  ", "/x").context).toBeNull();
  });

  it("jen sekce Non-goals → po vyříznutí nezbyde text → kontext null", () => {
    const content = `## ${INTENT_HEADINGS.nonGoals}\n- Do not run code.\n`;
    const intent = parseIntent(content, "/x");
    expect(intent.context).toBeNull();
    // non-goaly se přitom dál čtou strukturovaně (jdou do promptu zvlášť)
    expect(intent.nonGoals).toEqual(["Do not run code."]);
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

describe("loadIntent – domácí fallback ~/.vibeanalyzer", () => {
  let proj: string;
  let home: string;

  beforeEach(async () => {
    proj = await mkdtemp(path.join(tmpdir(), "vibe-intent-proj-"));
    home = await mkdtemp(path.join(tmpdir(), "vibe-intent-home-"));
  });

  afterEach(async () => {
    await rm(proj, { recursive: true, force: true }).catch(() => {});
    await rm(home, { recursive: true, force: true }).catch(() => {});
  });

  // Cestu k domácímu úložišti stavíme přes REÁLNou projectKey – ne přes natvrdo
  // zadaný hash. Kdyby se projectKey rozešla s loadIntent, test padne (má zuby).
  function homeStore(target: string): string {
    return path.join(home, ".vibeanalyzer", projectKey(target));
  }

  it("záměr jen v domácím úložišti → loaded se sourcePath z domova", async () => {
    const store = homeStore(proj);
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, "project.md"), MINI_FIXTURE, "utf8");

    const r = await loadIntent(proj, { homeDir: home });
    expect(r.kind).toBe("loaded");
    if (r.kind === "loaded") {
      expect(r.intent.building).toContain("Lokální CLI nástroj.");
      expect(r.intent.sourcePath).toBe(path.join(store, "project.md"));
    }
  });

  it("cíl má přednost před domovem (.mini/project.md vyhrává)", async () => {
    await mkdir(path.join(proj, ".mini"), { recursive: true });
    await writeFile(path.join(proj, ".mini", "project.md"), MINI_FIXTURE, "utf8");
    const store = homeStore(proj);
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, "project.md"), "## What I'm building\nz domova\n", "utf8");

    const r = await loadIntent(proj, { homeDir: home });
    expect(r.kind).toBe("loaded");
    if (r.kind === "loaded") {
      expect(r.intent.sourcePath).toBe(path.join(proj, ".mini", "project.md"));
    }
  });

  it("nikde (ani v domově) → absent", async () => {
    const r = await loadIntent(proj, { homeDir: home });
    expect(r.kind).toBe("absent");
  });

  it("domov neznámý (homeDir prázdný) → domácí kandidát se přeskočí, nehází", async () => {
    // i kdyby reálný ~/.vibeanalyzer cosi měl, prázdný homeDir ho vyřadí
    const r = await loadIntent(proj, { homeDir: "" });
    expect(r.kind).toBe("absent");
  });

  it("domácí project.md nečitelný (je to adresář) → unreadable, nepřeskočí se", async () => {
    const store = homeStore(proj);
    // project.md jako ADRESÁŘ → readFile hodí EISDIR
    await mkdir(path.join(store, "project.md"), { recursive: true });
    const r = await loadIntent(proj, { homeDir: home });
    expect(r.kind).toBe("unreadable");
    if (r.kind === "unreadable") {
      expect(r.path).toBe(path.join(store, "project.md"));
      expect(r.code).toBe("EISDIR");
    }
  });

  it("kolize basename: cizí záměr se nenačte (klíč je per-cesta)", async () => {
    // dva různé adresáře se STEJNÝM basename "app" v různých rodičích
    const parentA = await mkdtemp(path.join(tmpdir(), "vibe-A-"));
    const parentB = await mkdtemp(path.join(tmpdir(), "vibe-B-"));
    const appA = path.join(parentA, "app");
    const appB = path.join(parentB, "app");
    await mkdir(appA, { recursive: true });
    await mkdir(appB, { recursive: true });
    // domácí záměr existuje JEN pro appA
    const storeA = homeStore(appA);
    await mkdir(storeA, { recursive: true });
    await writeFile(path.join(storeA, "project.md"), MINI_FIXTURE, "utf8");

    try {
      // appB má stejný basename, ale jiný klíč → nesmí najít záměr appA
      const rB = await loadIntent(appB, { homeDir: home });
      expect(rB.kind).toBe("absent");
      // kontrola, že to vůbec funguje: appA svůj záměr najde
      const rA = await loadIntent(appA, { homeDir: home });
      expect(rA.kind).toBe("loaded");
    } finally {
      await rm(parentA, { recursive: true, force: true }).catch(() => {});
      await rm(parentB, { recursive: true, force: true }).catch(() => {});
    }
  });
});
