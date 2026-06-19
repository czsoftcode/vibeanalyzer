import type * as TS from "typescript";

/**
 * Vytáhne ze zdrojového textu RELATIVNÍ importní specifiery (`./`, `../`).
 *
 * Záměrně přes parser (`ts.createSourceFile`), ne přes regex: parser nevytáhne
 * importy schované v komentářích/řetězcích (žádné falešné nálezy) a zvládne
 * víceřádkové importy. Parser jen LEXUJE/PARSUJE – cizí kód NEvykonává
 * (non-goal č. 1). `ts` se injektuje (přibalený TypeScript z loadTypescript),
 * ať modul nemá vlastní načítací logiku a jde testovat s reálným `ts`.
 *
 * Bere:
 *   - `import x from "./y"`, `import { a } from "./y"`, `import * as n from "./y"`
 *   - `import "./y"` (side-effect), `import type { T } from "./y"`
 *   - `export { a } from "./y"`, `export * from "./y"`
 * NEbere (v1):
 *   - dynamický `import("./y")` a `require("./y")` – jsou to výrazy, ne deklarace
 *     na úrovni modulu, takže do `sf.statements` nespadnou a procházíme jen ty
 *   - `import x = require("./y")` (TS import-equals) – vzácné, vynecháno
 *   - bare/balíkové specifiery (`react`, `node:fs`) – nezačínají `./` ani `../`
 *
 * Nikdy nehází na vadný vstup: `createSourceFile` je tolerantní k syntaktickým
 * chybám (vrátí strom s chybovými uzly), takže rozbitý/nezralý soubor jen vrátí,
 * co se z něj dá přečíst. (Patologicky hluboké vnoření může přetéct zásobník –
 * to chytá až volající ve `buildModuleGraph`.)
 */
export function extractRelativeSpecifiers(
  ts: typeof import("typescript"),
  text: string,
  ext: string,
): string[] {
  const sf = ts.createSourceFile(
    `vibe-import-probe${ext}`,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(ts, ext),
  );

  const out = new Set<string>();
  for (const stmt of sf.statements) {
    let spec: TS.Expression | undefined;
    if (ts.isImportDeclaration(stmt)) {
      spec = stmt.moduleSpecifier;
    } else if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier) {
      // `export … from "…"` nese specifier; `export { a }` (bez from) ne.
      spec = stmt.moduleSpecifier;
    }
    if (spec && ts.isStringLiteral(spec) && isRelative(spec.text)) {
      out.add(spec.text);
    }
  }
  return [...out];
}

/** Relativní = začíná `./` nebo `../`. Bare (`react`) ani `node:fs` sem nespadne. */
function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Přípona → ScriptKind. JSX zapínáme jen pro `.jsx`/`.tsx`; `.ts` s JSX schválně
 * NEparsujeme (kolidovalo by s `<T>` přetypováním). Pro extrakci importů na tom
 * skoro nezáleží (importy jsou na vršku modulu a parser je tolerantní), ale
 * správný kind ušetří chybové uzly v těle.
 */
function scriptKindFor(ts: typeof import("typescript"), ext: string): TS.ScriptKind {
  switch (ext) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      // .ts/.mts/.cts a cokoli neznámého bereme jako TS
      return ts.ScriptKind.TS;
  }
}
