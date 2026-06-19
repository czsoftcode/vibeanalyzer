import { describe, expect, it } from "vitest";
import type { ModuleGraphResult } from "../analyze/moduleGraph.js";
import { buildMarkdown, buildModuleDiagram, type MarkdownInput } from "./markdown.js";

function input(mg: ModuleGraphResult | undefined): MarkdownInput {
  return {
    root: "/proj",
    generatedAt: "2026-06-19T00:00:00.000Z",
    files: [],
    skippedUnreadable: [],
    moduleGraph: mg,
  };
}

describe("buildMarkdown – sekce Graf modulů", () => {
  it("skipped → explicitní 'přeskočen' s důvodem (ne tichá díra)", () => {
    const md = buildMarkdown(input({ kind: "skipped", reason: "parser nedostupný" }));
    expect(md).toContain("## Graf modulů");
    expect(md).toContain("Graf modulů přeskočen: parser nedostupný");
    expect(md).toContain("- Graf modulů: přeskočeno"); // summary řádek
  });

  it("undefined → taky 'přeskočen' (vrstva neproběhla), ne prázdno", () => {
    const md = buildMarkdown(input(undefined));
    expect(md).toContain("Graf modulů přeskočen");
  });

  it("ran s hranami → Mermaid graph LR s uzly a šipkou", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
      isolated: [],
      fileCount: 2,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph LR");
    expect(md).toContain('["src/a.ts"]');
    expect(md).toContain('["src/b.ts"]');
    expect(md).toMatch(/n\d+ --> n\d+/);
    expect(md).toContain("- Graf modulů: 1 hran mezi 2 soubory");
  });

  it("ran bez hran → explicitní 'žádné hrany', ne prázdná sekce", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [],
      isolated: ["src/x.ts"],
      fileCount: 1,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("Žádné importní hrany");
    // graf modulů nemá vlastní mermaid blok; sekce stejně existuje
    expect(md).toContain("## Graf modulů");
  });

  it("osamělé moduly se NEkreslí, jen vypíšou", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
      isolated: ["src/bin.ts", "src/version.ts"],
      fileCount: 4,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("**Osamělé moduly (bez importní vazby):** 2");
    expect(md).toContain("`src/bin.ts`");
    expect(md).toContain("`src/version.ts`");
    // osamělé nesmí být uzlem grafu
    expect(md).not.toContain('["src/bin.ts"]');
  });

  it("prázdný graf POUZE kvůli přeskočeným souborům se odliší od 'projekt bez importů'", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [],
      isolated: [],
      fileCount: 0,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 5, // všechny zdrojáky jsou bundly nad limitem
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("nezbyl k sestavení grafu");
    expect(md).not.toContain("Žádné importní hrany mezi soubory projektu");
  });

  it("přeskočené soubory (nečitelné/velké) se přiznají", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [],
      isolated: [],
      fileCount: 0,
      unreadable: 2,
      unparsable: 1,
      tooLarge: 3,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("2 nečitelných");
    expect(md).toContain("1 nezparsovatelných");
    expect(md).toContain("3 příliš velkých");
  });

  it("projekt JEN z minifikátů (fileCount=0, minified>0) NElže 'žádné importní hrany'", () => {
    // Reálná díra: bez minified v allSkipped sumě by report spadl do else větve
    // a tvrdil 'žádné importní hrany mezi soubory' = tichý falešný 'čisto', ač se
    // jen vše vyřadilo jako bundle. Když rozbiju opravu, tenhle test padne.
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [],
      isolated: [],
      fileCount: 0,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 3,
    };
    const md = buildMarkdown(input(mg));
    expect(md).not.toContain("Žádné importní hrany mezi soubory projektu"); // lež
    expect(md).toContain("nezbyl k sestavení grafu"); // pravdivá hláška
    expect(md).toContain("3 minifikátů (podle jména)"); // a přiznaný počet
  });

  it("vyřazené minifikáty se přiznají v souhrnu i v sekci grafu", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
      isolated: [],
      fileCount: 2,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 3,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("- Graf modulů: 1 hran mezi 2 soubory (3 minifikátů vyřazeno)"); // souhrn
    expect(md).toContain("3 minifikátů (podle jména)"); // poznámka v sekci
  });

  it("minified: 0 → souhrn ani poznámka o minifikátech nelže (žádný dovětek)", () => {
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges: [{ from: "src/a.ts", to: "src/b.ts" }],
      isolated: [],
      fileCount: 2,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    expect(md).toContain("- Graf modulů: 1 hran mezi 2 soubory");
    expect(md).not.toContain("minifikátů vyřazeno");
    expect(md).not.toContain("minifikátů (podle jména)");
  });
});

describe("buildMarkdown – výchozí strop respektuje limit Mermaidu (500 hran)", () => {
  it("graf nad 500 hran se v reportu ořízne pod limit, ne vykreslí 600 hran (jinak Mermaid error)", () => {
    // 600 hran z jednoho hubu → 601 uzlů (uzlový strop 1000 nesváže, sváže hranový).
    const edges = Array.from({ length: 600 }, (_, i) => ({ from: "hub.ts", to: `t${i}.ts` }));
    const mg: ModuleGraphResult = {
      kind: "ran",
      edges,
      isolated: [],
      fileCount: 601,
      unreadable: 0,
      unparsable: 0,
      tooLarge: 0,
      minified: 0,
    };
    const md = buildMarkdown(input(mg));
    const arrowCount = (md.match(/ --> /g) ?? []).length;
    expect(arrowCount).toBeLessThan(500); // pod tvrdým limitem Mermaidu
    expect(arrowCount).toBe(480); // konkrétně výchozí strop
    expect(md).toContain("tvrdým limitem Mermaidu (500)");
    expect(md).toContain("z 600 hran");
  });
});

describe("buildModuleDiagram", () => {
  it("id uzlu jde podle CESTY – dva index.ts v různých složkách se neslijí", () => {
    const d = buildModuleDiagram(
      [
        { from: "a/index.ts", to: "shared.ts" },
        { from: "b/index.ts", to: "shared.ts" },
      ],
      3000,
      6000,
    );
    expect(d.shownNodes).toBe(3); // a/index.ts, b/index.ts, shared.ts – tři různé uzly
    expect(d.totalEdges).toBe(2);
    expect(d.truncated).toBe(false);
  });

  it("pojistný strop uzlů ořízne a nahlásí truncated", () => {
    const edges = [
      { from: "a.ts", to: "b.ts" },
      { from: "c.ts", to: "d.ts" }, // tahle hrana přidává 2 uzly → přeteče limit 2
    ];
    const d = buildModuleDiagram(edges, 2, 6000);
    expect(d.shownNodes).toBe(2);
    expect(d.shownEdges).toBe(1);
    expect(d.totalNodes).toBe(4);
    expect(d.truncated).toBe(true);
  });

  it("pojistný strop hran ořízne", () => {
    const edges = [
      { from: "a.ts", to: "b.ts" },
      { from: "a.ts", to: "c.ts" },
      { from: "a.ts", to: "d.ts" },
    ];
    const d = buildModuleDiagram(edges, 3000, 2);
    expect(d.shownEdges).toBe(2);
    expect(d.truncated).toBe(true);
  });

  it("CR/LF a backtick v cestě se z labelu zahodí (Mermaid injection)", () => {
    const d = buildModuleDiagram([{ from: "a.ts", to: "we`ird\nname.ts" }], 3000, 6000);
    const labelLine = d.lines.find((l) => l.includes("ird"));
    expect(labelLine).toBeDefined();
    expect(labelLine).not.toContain("`");
    expect(labelLine).not.toContain("\n");
  });
});
