import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type TS from "typescript";
import type { Finding, Severity, TscResult } from "../findings.js";
import { type LoadedTypescript, loadTypescript } from "./loadTypescript.js";

export interface TscAnalyzeDeps {
  /** injektovatelný loader (test si podstrčí svůj) */
  loadTs?: (root: string) => Promise<LoadedTypescript>;
  /**
   * Zavolá se PO naparsování tsconfigu, těsně před (potenciálně dlouhým) během
   * tsc – aby CLI mohlo vypsat "spouštím tsc nad N souborů". Bez timeoutu: u
   * obřího monorepa to může chvíli viset (vědomě přijaté riziko V1).
   */
  onStart?: (fileCount: number, tsSource: "project" | "bundled") => void;
}

/**
 * Strojová typová analýza projektu přes tsc (jen kontrola, NIC nespouští).
 *
 * Vrací diskriminovaný výsledek, NEHÁZÍ na očekávaných cizích vstupech:
 *   - chybí kořenový tsconfig.json → skipped (není to TS projekt)
 *   - tsconfig nejde naparsovat / má fatální chybu konfigurace → skipped
 *   - jinak proběhne tsc a vrátí nálezy (i prázdné = "ran", ne "skipped")
 *
 * NIKDY nezapisuje do analyzovaného projektu: vynucený `noEmit` + vypnutý
 * incremental/composite/tsBuildInfo, ať nevznikne .tsbuildinfo (non-goal č. 1).
 */
export async function analyzeTypeScript(root: string, deps: TscAnalyzeDeps = {}): Promise<TscResult> {
  const loadTs = deps.loadTs ?? loadTypescript;
  const tsconfigPath = path.join(root, "tsconfig.json");

  let configRaw: string;
  try {
    configRaw = await readFile(tsconfigPath, "utf8");
  } catch {
    return { kind: "skipped", reason: "v kořeni projektu není tsconfig.json (není to TypeScript projekt?)" };
  }

  const { ts, source } = await loadTs(root);

  // tsconfig je JSONC (komentáře) – parsujeme přes tsc, ne JSON.parse.
  const jsonParsed = ts.parseConfigFileTextToJson(tsconfigPath, configRaw);
  if (jsonParsed.error) {
    return { kind: "skipped", reason: "tsconfig.json se nepodařilo naparsovat (poškozený JSON?)" };
  }

  const configDir = path.dirname(tsconfigPath);
  const cmd = ts.parseJsonConfigFileContent(jsonParsed.config, ts.sys, configDir);

  // TS18003 = "v configu se nenašly žádné vstupní soubory" – to je STAV (prázdný
  // projekt), ne chyba configu. Oddělíme ho od SKUTEČNÝCH chyb konfigurace
  // (neznámá volba, extends na neexistující soubor, …), které do reportu PATŘÍ.
  const TS_NO_INPUTS = 18003;
  const configDiagnostics = cmd.errors.filter((e) => e.code !== TS_NO_INPUTS);

  if (cmd.fileNames.length === 0) {
    // config je, ale nezahrnul žádný soubor. Rozlišíme rozbitý config od prostě
    // prázdného projektu – ať reason nelže (žádné "chyba konfigurace", kde není).
    const realConfigError = configDiagnostics.some((e) => e.category === ts.DiagnosticCategory.Error);
    if (realConfigError) {
      return { kind: "skipped", reason: "tsconfig.json obsahuje chybu konfigurace" };
    }
    return { kind: "skipped", reason: "tsconfig nezahrnul žádné soubory k analýze" };
  }

  // Přebijeme volby tak, aby tsc NIKDY nesáhl na disk projektu.
  const options: TS.CompilerOptions = {
    ...cmd.options,
    noEmit: true,
    incremental: false,
    composite: false,
    tsBuildInfoFile: undefined,
    declaration: false,
    declarationMap: false,
    sourceMap: false,
  };

  deps.onStart?.(cmd.fileNames.length, source);

  const program = ts.createProgram(cmd.fileNames, options);
  // POZOR: getPreEmitDiagnostics NEvrací chyby konfigurace (cmd.errors). Kdybychom
  // je nepřidali, "extends na neexistující soubor" nebo neznámá volba by zmizely
  // a report by lhal "0 nálezů" nad rozbitým configem (tichý falešný úspěch).
  const diagnostics = [...configDiagnostics, ...ts.getPreEmitDiagnostics(program)];
  const findings = diagnostics.map((d) => toFinding(ts, d, root));
  const nodeModulesPresent = await hasNodeModules(root);

  return { kind: "ran", findings, fileCount: cmd.fileNames.length, nodeModulesPresent };
}

async function hasNodeModules(root: string): Promise<boolean> {
  try {
    const s = await stat(path.join(root, "node_modules"));
    return s.isDirectory();
  } catch {
    return false;
  }
}

function categoryToSeverity(ts: typeof TS, category: TS.DiagnosticCategory): Severity {
  switch (category) {
    case ts.DiagnosticCategory.Error:
      return "error";
    case ts.DiagnosticCategory.Warning:
      return "warning";
    default:
      return "info"; // Suggestion / Message
  }
}

/** Mapuje tsc diagnostiku na Finding. Diagnostika bez souboru → file/line nevyplněné. */
function toFinding(ts: typeof TS, d: TS.Diagnostic, root: string): Finding {
  const severity = categoryToSeverity(ts, d.category);
  const message = ts.flattenDiagnosticMessageText(d.messageText, "\n");
  const rule = typeof d.code === "number" ? `TS${d.code}` : undefined;

  if (d.file && d.start !== undefined) {
    const { line, character } = d.file.getLineAndCharacterOfPosition(d.start);
    return {
      source: "tsc",
      severity,
      file: toRelPosix(root, d.file.fileName),
      line: line + 1,
      column: character + 1,
      rule,
      message,
    };
  }
  return { source: "tsc", severity, rule, message };
}

/** Cesta relativní ke kořeni s oddělovačem "/" (jako zbytek reportu). */
function toRelPosix(root: string, abs: string): string {
  const rel = path.relative(root, abs);
  return rel.split(path.sep).join("/");
}
