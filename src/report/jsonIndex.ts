import type { FileEntry } from "../scan.js";

/** Strojový strukturální index – výstup fáze 1. Bez symbolů (importy/exporty). */
export interface JsonIndex {
  version: number;
  generatedAt: string;
  root: string;
  files: FileEntry[];
}

export const INDEX_VERSION = 1;

export function buildJsonIndex(root: string, generatedAt: string, files: FileEntry[]): JsonIndex {
  return {
    version: INDEX_VERSION,
    generatedAt,
    root,
    files,
  };
}
