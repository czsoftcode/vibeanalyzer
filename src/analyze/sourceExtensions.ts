/**
 * JEDINÝ zdroj pravdy pro přípony zdrojových JS/TS souborů.
 *
 * Sdílí ho víc modulů (eslintConfig pro lint globy, resolveImport/moduleGraph pro
 * graf importů) – proto leží v samostatném souboru BEZ těžkých závislostí. Kdyby
 * tahle množina byla v eslintConfig.ts (které importuje `@typescript-eslint/parser`),
 * každý konzument by si ten parser zbytečně zatáhl. Drž je tady, ať se kontrakt
 * o příponách nikde nerozejde a nikdo netahá ESLint, kdo ho nepotřebuje.
 */
export const JS_EXTENSIONS: readonly string[] = [".js", ".jsx", ".mjs", ".cjs"];
export const TS_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

/** Všechny zdrojové přípony (JS + TS). */
export const SOURCE_EXTENSIONS: readonly string[] = [...JS_EXTENSIONS, ...TS_EXTENSIONS];
