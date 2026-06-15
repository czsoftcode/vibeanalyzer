import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import * as path from "node:path";

/** Výsledek parsování argumentů příkazové řádky. */
export type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "run"; targetPath: string; outDir: string | null }
  | { kind: "error"; message: string };

/**
 * Výchozí výstupní adresář, když uživatel nezadá `--out`:
 * `<home>/.vibeanalyzer/<jméno projektu>`. Jméno projektu je poslední část
 * cílové cesty; pro kořen (prázdný basename) se použije "root".
 */
export function defaultOutDir(homeDir: string, targetPath: string): string {
  const name = path.basename(targetPath) || "root";
  return path.join(homeDir, ".vibeanalyzer", name);
}

/**
 * Zpracuje argumenty (bez vedlejších efektů – nesahá na disk).
 * `vibeanalyzer [cesta] [--out <adresář>]`; bez cesty se bere ".".
 * `outDir === null` znamená "použij výchozí" (viz defaultOutDir) – samotné
 * parsování nezná home adresář, ten dopočítá až volající.
 */
export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  let target: string | undefined;
  let out: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "-h" || a === "--help") return { kind: "help" };
    if (a === "-v" || a === "--version") return { kind: "version" };
    if (a === "-o" || a === "--out") {
      const val = argv[i + 1];
      if (val === undefined || val.startsWith("-")) {
        return { kind: "error", message: `Volba ${a} vyžaduje cestu k adresáři.` };
      }
      out = val;
      i++;
      continue;
    }
    if (a.startsWith("--out=")) {
      out = a.slice("--out=".length);
      continue;
    }
    if (a.startsWith("-")) {
      return { kind: "error", message: `Neznámá volba: ${a}` };
    }
    if (target === undefined) {
      target = a;
      continue;
    }
    return { kind: "error", message: `Nečekaný argument navíc: ${a}` };
  }

  const targetPath = path.resolve(cwd, target ?? ".");
  const outDir = out === undefined ? null : path.resolve(cwd, out);
  return { kind: "run", targetPath, outDir };
}

/** Výsledek validace cílové cesty. */
export type ValidationResult = { ok: true } | { ok: false; message: string };

/**
 * Ověří, že cílová cesta existuje, je adresář a jde z ní číst.
 * Žádný pád – nečekané chyby se převedou na srozumitelnou hlášku.
 */
export async function validateTarget(targetPath: string): Promise<ValidationResult> {
  let st;
  try {
    st = await stat(targetPath);
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") return { ok: false, message: `Cesta neexistuje: ${targetPath}` };
    if (e.code === "EACCES") return { ok: false, message: `K cestě nemáš oprávnění: ${targetPath}` };
    return { ok: false, message: `Cestu nelze otevřít: ${targetPath} (${e.code ?? "neznámá chyba"})` };
  }
  if (!st.isDirectory()) {
    return { ok: false, message: `Cesta není adresář: ${targetPath}` };
  }
  try {
    await access(targetPath, fsConstants.R_OK);
  } catch {
    return { ok: false, message: `Adresář nelze číst (chybí oprávnění): ${targetPath}` };
  }
  return { ok: true };
}
