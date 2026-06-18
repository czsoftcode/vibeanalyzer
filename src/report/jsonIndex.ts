import type { EslintResult, TscResult } from "../findings.js";
import type { FileEntry } from "../scan.js";

/**
 * Strojový strukturální index. Od verze 2 nese výsledek tsc vrstvy (`tsc`), od
 * verze 3 i ESLint vrstvy (`eslint`) – celé diskriminované výsledky, ne jen pole
 * nálezů, aby ze strojového výstupu šlo poznat i "přeskočeno" vs "čistý projekt"
 * (jinak by i JSON tiše lhal).
 */
export interface JsonIndex {
  version: number;
  generatedAt: string;
  root: string;
  files: FileEntry[];
  /** výsledek strojové typové analýzy (tsc) */
  tsc: TscResult;
  /** výsledek lint analýzy (ESLint) */
  eslint: EslintResult;
}

/** Bump 3 → 4: tsc výsledek nese `tsVersion` (+ volitelně `projectTsVersion`). Kontrakt s konzumenty JSON. */
export const INDEX_VERSION = 4;

export function buildJsonIndex(
  root: string,
  generatedAt: string,
  files: FileEntry[],
  tsc: TscResult,
  eslint: EslintResult,
): JsonIndex {
  return {
    version: INDEX_VERSION,
    generatedAt,
    root,
    files,
    tsc,
    eslint,
  };
}
