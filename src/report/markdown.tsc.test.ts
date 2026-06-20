import { describe, expect, it } from "vitest";
import type { TscResult } from "../findings.js";
import { buildMarkdown } from "./markdown.js";

const base = {
  root: "/p",
  generatedAt: "t",
  files: [],
  skippedUnreadable: [],
};

describe("buildMarkdown – sekce Strojové nálezy (tsc)", () => {
  it("skipped: vypíše důvod, ne pád", () => {
    const tsc: TscResult = { kind: "skipped", reason: "v kořeni není tsconfig.json" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("## Strojové nálezy (tsc)");
    expect(md).toContain("_tsc přeskočeno: v kořeni není tsconfig.json_");
    expect(md).toContain("- tsc: přeskočeno");
  });

  it("ran s 0 nálezy NENÍ totéž co přeskočeno", () => {
    const tsc: TscResult = { kind: "ran", findings: [], fileCount: 3, nodeModulesPresent: true, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("_Žádné typové chyby._");
    expect(md).toContain("- tsc: čistý (0 nálezů)");
    expect(md).not.toContain("tsc přeskočeno");
  });

  it("ran s nálezy: soubor:řádek:sloupec, závažnost, kód, zpráva", () => {
    const tsc: TscResult = {
      kind: "ran",
      tsVersion: "5.9.3",
      fileCount: 1,
      nodeModulesPresent: true,
      findings: [
        { source: "tsc", severity: "error", file: "src/a.ts", line: 7, column: 3, rule: "TS2322", message: "Type 'string' is not assignable to type 'number'." },
      ],
    };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("`src/a.ts:7:3`");
    expect(md).toContain("TS2322");
    expect(md).toContain("**error**");
    expect(md).toContain("- tsc: 1 nálezů");
  });

  it("chybějící node_modules (ne-hoisted) → stará poznámka o nenalezených modulech", () => {
    const tsc: TscResult = { kind: "ran", findings: [], fileCount: 1, nodeModulesPresent: false, hoistedNodeModules: false, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("chybí `node_modules`");
    expect(md).toContain("TS2307");
    // vzájemná exkluze: ne-hoisted NESMÍ ukázat hoisted poznámku
    expect(md).not.toContain("monorepo");
  });

  it("víceřádková zpráva i backtick se zploští do jedné odrážky", () => {
    const tsc: TscResult = {
      kind: "ran",
      tsVersion: "5.9.3",
      fileCount: 1,
      nodeModulesPresent: true,
      findings: [{ source: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, message: "řádek1\nřádek2 `code`" }],
    };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("řádek1 řádek2 'code'");
    // zpráva nesmí přidat vlastní newline doprostřed odrážky
    const bullet = md.split("\n").find((l) => l.includes("řádek1"));
    expect(bullet).toContain("řádek2");
  });

  it("ZUBY (SEC-2): CR/LF v názvu souboru (loc) se zploští – odrážka zůstane jednořádková", () => {
    const tsc: TscResult = {
      kind: "ran",
      tsVersion: "5.9.3",
      fileCount: 1,
      nodeModulesPresent: true,
      findings: [{ source: "tsc", severity: "error", file: "evil\n## Injekce.ts", line: 1, column: 1, message: "zpráva" }],
    };
    const md = buildMarkdown({ ...base, tsc });
    // injektovaný nadpis se NEvyrenderuje jako samostatný řádek (STARÝ kód: newline projde)
    expect(md).not.toContain("\n## Injekce.ts");
    // celý loc zůstane na JEDNÉ odrážce (newline → mezera)
    const bullet = md.split("\n").find((l) => l.includes("evil"));
    expect(bullet).toBeDefined();
    expect(bullet).toContain("Injekce.ts");
  });

  it("nález bez souboru (globální chyba) → (bez umístění), nespadne", () => {
    const tsc: TscResult = {
      kind: "ran",
      tsVersion: "5.9.3",
      fileCount: 0,
      nodeModulesPresent: true,
      findings: [{ source: "tsc", severity: "error", rule: "TS5023", message: "Unknown compiler option." }],
    };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("`(bez umístění)`");
    expect(md).toContain("TS5023");
  });

  it("ran vždy ukáže POUŽITOU verzi TS; bez rozdílu žádná poznámka o verzi", () => {
    const tsc: TscResult = { kind: "ran", findings: [], fileCount: 1, nodeModulesPresent: true, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("tsc (TS 5.9.3) proběhl");
    expect(md).not.toContain("projekt používá"); // bez projectTsVersion žádná poznámka o rozdílu
  });

  it("projectTsVersion → poznámka přizná verzní rozdíl (přibalená vs projektová)", () => {
    const tsc: TscResult = {
      kind: "ran",
      findings: [],
      fileCount: 1,
      nodeModulesPresent: true,
      tsVersion: "5.9.3",
      projectTsVersion: "5.4.0",
    };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("typováno přibaleným TypeScriptem 5.9.3");
    expect(md).toContain("projekt používá 5.4.0");
  });

  it("bez tsc vstupu → sekce přesto existuje a hlásí přeskočeno", () => {
    const md = buildMarkdown({ ...base });
    expect(md).toContain("## Strojové nálezy (tsc)");
    expect(md).toContain("_tsc přeskočeno:");
  });
});

describe("buildMarkdown – trojstav poznámky o node_modules (hoisted monorepo)", () => {
  const ts2307 = { source: "tsc", severity: "error", file: "a.ts", line: 1, column: 1, rule: "TS2307", message: "Cannot find module 'lodash'." } as const;

  it("hoisted + reálný TS2307 → hoisted poznámka, NE stará (vzájemná exkluze)", () => {
    const tsc: TscResult = { kind: "ran", findings: [ts2307], fileCount: 1, nodeModulesPresent: false, hoistedNodeModules: true, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).toContain("monorepo");
    expect(md).toContain("hoisted");
    // stará poznámka ("chybí node_modules") se NESMÍ objevit zároveň
    expect(md).not.toContain("tsc běžel bez nainstalovaných závislostí");
  });

  it("hoisted, ale BEZ TS2307 → žádná poznámka (nic nepadlo, není co vysvětlovat)", () => {
    const tsc: TscResult = { kind: "ran", findings: [], fileCount: 1, nodeModulesPresent: false, hoistedNodeModules: true, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).not.toContain("monorepo"); // žádná hoisted poznámka bez reálné příčiny
    expect(md).not.toContain("chybí `node_modules`"); // ani stará – kořen sice nemá, ale leží výš
  });

  it("pnpm-like (kořen MÁ node_modules) → žádná poznámka, i kdyby byl TS2307", () => {
    const tsc: TscResult = { kind: "ran", findings: [ts2307], fileCount: 1, nodeModulesPresent: true, hoistedNodeModules: false, tsVersion: "5.9.3" };
    const md = buildMarkdown({ ...base, tsc });
    expect(md).not.toContain("monorepo");
    expect(md).not.toContain("chybí `node_modules`");
  });
});
