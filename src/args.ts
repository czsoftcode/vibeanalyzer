import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import * as path from "node:path";
import type { AiModelChoice } from "./analyze/aiStatus.js";
import { projectKey } from "./projectPaths.js";

/** Povolené hodnoty `--ai-model` (kontrakt s AiModelChoice). */
const AI_MODELS: readonly AiModelChoice[] = ["opus", "sonnet"];

/** Výsledek parsování argumentů příkazové řádky. */
export type ParsedArgs =
  | { kind: "help" }
  | { kind: "version" }
  | {
      kind: "run";
      targetPath: string;
      outDir: string | null;
      audit: boolean;
      dev: boolean;
      aiCheck: boolean;
      aiNonGoal: boolean;
      aiCode: boolean;
      aiModel: AiModelChoice;
    }
  | { kind: "error"; message: string };

/**
 * Výchozí výstupní adresář, když uživatel nezadá `--out`:
 * `<home>/.vibeanalyzer/<projectKey>`. Klíč je sdílený s `intent.loadIntent`
 * (kam se píše report = odkud se čte záměr), tvar `basename-<hash>` – viz
 * `projectKey`. Hash drží oddělené projekty se stejným jménem (žádný přepis
 * cizího reportu).
 */
export function defaultOutDir(homeDir: string, targetPath: string): string {
  return path.join(homeDir, ".vibeanalyzer", projectKey(targetPath));
}

/**
 * Zpracuje argumenty (bez vedlejších efektů – nesahá na disk).
 * `vibeanalyzer [cesta] [--out <adresář>] [--audit] [--dev]`; bez cesty se bere ".".
 * `outDir === null` znamená "použij výchozí" (viz defaultOutDir) – samotné
 * parsování nezná home adresář, ten dopočítá až volající.
 *
 * `--audit` zapne (opt-in) audit závislostí přes `npm audit` (síťová operace).
 * `--dev` k auditu přidá i vývojové závislosti; SAMOTNÉ `--dev` (bez `--audit`)
 * je neúčinné – parser ho jen zaznamená, varování řeší CLI (args bez side efektů).
 * `--ai-check` zapne (opt-in) levný testovací dotaz na API; bez něj se AI vrstva
 * jen podívá po klíči (offline). `--ai-non-goal` zapne (opt-in) reálnou analýzu
 * porušení non-goalů, `--ai-code` reálnou analýzu kvality/rizik kódu – obě jsou
 * samostatné drahé cesty, každá vlastní dotaz na API (lze i obě naráz). `--ai-model
 * <opus|sonnet>` volí model pro obě (default opus). Vyhodnocení (síť, klíč, samotné
 * --ai-model bez AI běhu) řeší CLI, ne parser.
 */
export function parseArgs(argv: readonly string[], cwd: string): ParsedArgs {
  let target: string | undefined;
  let out: string | undefined;
  let audit = false;
  let dev = false;
  let aiCheck = false;
  let aiNonGoal = false;
  let aiCode = false;
  let aiModel: AiModelChoice = "opus";

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
      // Na rozdíl od dvouargumentové formy NEodmítáme hodnotu začínající "-":
      // rovnítko ji explicitně oddělilo, takže `--out=-x` jednoznačně znamená
      // adresář "-x" (žádné riziko spolknutí následujícího příznaku). Odmítáme
      // jen prázdnou hodnotu, která by se přes path.resolve tiše rozvinula na CWD.
      const val = a.slice("--out=".length);
      if (val === "") {
        return { kind: "error", message: `Volba --out vyžaduje cestu k adresáři.` };
      }
      out = val;
      continue;
    }
    if (a === "--audit") {
      audit = true;
      continue;
    }
    if (a === "--dev") {
      dev = true;
      continue;
    }
    if (a === "--ai-check") {
      aiCheck = true;
      continue;
    }
    if (a === "--ai-non-goal") {
      aiNonGoal = true;
      continue;
    }
    if (a === "--ai-code") {
      aiCode = true;
      continue;
    }
    if (a === "--ai-model") {
      const val = argv[i + 1];
      if (val === undefined || !AI_MODELS.includes(val as AiModelChoice)) {
        return { kind: "error", message: `Volba --ai-model vyžaduje model: ${AI_MODELS.join(" | ")}.` };
      }
      aiModel = val as AiModelChoice;
      i++;
      continue;
    }
    if (a.startsWith("--ai-model=")) {
      const val = a.slice("--ai-model=".length);
      if (!AI_MODELS.includes(val as AiModelChoice)) {
        return { kind: "error", message: `Volba --ai-model vyžaduje model: ${AI_MODELS.join(" | ")}.` };
      }
      aiModel = val as AiModelChoice;
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
  return { kind: "run", targetPath, outDir, audit, dev, aiCheck, aiNonGoal, aiCode, aiModel };
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
