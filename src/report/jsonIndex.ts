import type { TscResult } from "../findings.js";
import type { FileEntry } from "../scan.js";

/**
 * Strojový strukturální index. Od verze 2 nese i výsledek tsc vrstvy (`tsc`):
 * celý diskriminovaný TscResult, ne jen pole nálezů – aby ze strojového výstupu
 * šlo poznat i "přeskočeno" vs "čistý projekt" (jinak by i JSON tiše lhal).
 */
export interface JsonIndex {
  version: number;
  generatedAt: string;
  root: string;
  files: FileEntry[];
  /** výsledek strojové typové analýzy (tsc) */
  tsc: TscResult;
}

/** Bump 1 → 2: přidáno pole `tsc`. Kontrakt s konzumenty JSON. */
export const INDEX_VERSION = 2;

export function buildJsonIndex(
  root: string,
  generatedAt: string,
  files: FileEntry[],
  tsc: TscResult,
): JsonIndex {
  return {
    version: INDEX_VERSION,
    generatedAt,
    root,
    files,
    tsc,
  };
}
