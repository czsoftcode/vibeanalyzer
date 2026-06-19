import { describe, expect, it } from "vitest";
import { resolveSpecifier } from "./resolveImport.js";

// Reálná sada cest (jako by ze scanu), ne mock vracející natvrdo hodnotu.
const scanned = new Set<string>([
  "src/cli.ts",
  "src/scan.ts",
  "src/report/markdown.ts",
  "src/report/index.ts",
  "src/legacy/util.js",
  "src/ui/Button.tsx",
  "src/utils/index.ts",
]);

describe("resolveSpecifier", () => {
  it("HLAVNÍ PAST: import s .js se napojí na zdroj .ts", () => {
    expect(resolveSpecifier("./scan.js", "src/cli.ts", scanned)).toBe("src/scan.ts");
  });

  it(".js se napojí i na .tsx (ESM specifier míří na TSX zdroj)", () => {
    expect(resolveSpecifier("./ui/Button.js", "src/cli.ts", scanned)).toBe("src/ui/Button.tsx");
  });

  it("čistě JS projekt: .js se napojí na reálný .js", () => {
    expect(resolveSpecifier("./legacy/util.js", "src/cli.ts", scanned)).toBe("src/legacy/util.js");
  });

  it("`..` se vyřeší vůči adresáři importujícího souboru", () => {
    expect(resolveSpecifier("../scan.js", "src/report/markdown.ts", scanned)).toBe("src/scan.ts");
  });

  it("extensionless import zkusí zdrojové přípony", () => {
    expect(resolveSpecifier("./scan", "src/cli.ts", scanned)).toBe("src/scan.ts");
  });

  it("adresářový import se napojí na index.*", () => {
    expect(resolveSpecifier("./report/index.js", "src/cli.ts", scanned)).toBe("src/report/index.ts");
    expect(resolveSpecifier("./utils", "src/cli.ts", scanned)).toBe("src/utils/index.ts");
  });

  it("import '..' z podsložky se napojí na kořenový index.* (ne tichá chybějící hrana)", () => {
    const withRootIndex = new Set<string>(["index.ts", "src/foo.ts"]);
    expect(resolveSpecifier("..", "src/foo.ts", withRootIndex)).toBe("index.ts");
  });

  it("import '.' z kořene najde kořenový index.* (sebe odfiltruje až graf)", () => {
    const withRootIndex = new Set<string>(["index.ts"]);
    expect(resolveSpecifier(".", "main.ts", withRootIndex)).toBe("index.ts");
  });

  it("neexistující cíl = null (ne tichá falešná hrana)", () => {
    expect(resolveSpecifier("./neexistuje.js", "src/cli.ts", scanned)).toBeNull();
  });

  it("necílová přípona (.css/.json) = null (není modul grafu)", () => {
    expect(resolveSpecifier("./styles.css", "src/cli.ts", scanned)).toBeNull();
    expect(resolveSpecifier("./data.json", "src/cli.ts", scanned)).toBeNull();
  });

  it("cesta vedoucí nad kořen = null (uniká z projektu)", () => {
    expect(resolveSpecifier("../../outside.js", "src/cli.ts", scanned)).toBeNull();
  });
});
