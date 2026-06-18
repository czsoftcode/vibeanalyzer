import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import type TS from "typescript";
import type { Finding, Severity, TscResult } from "../findings.js";
import { type LoadedTypescript, loadTypescript } from "./loadTypescript.js";

export interface TscAnalyzeDeps {
  /** injektovatelný loader (test si podstrčí svůj). Bez root: vždy přibalený TS. */
  loadTs?: () => Promise<LoadedTypescript>;
  /**
   * Zavolá se PO naparsování tsconfigu, těsně před (potenciálně dlouhým) během
   * tsc – aby CLI mohlo vypsat "spouštím tsc (TS <verze>) nad N souborů". Druhý
   * argument je verze použitého (přibaleného) TypeScriptu.
   */
  onStart?: (fileCount: number, tsVersion: string) => void;
  /** injektovatelné čtení verze TS projektu (test si podstrčí svou); jinak reálné */
  readProjectTsVersion?: (root: string) => Promise<string | undefined>;
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
  const readProjectTsVersion = deps.readProjectTsVersion ?? readProjectTypescriptVersion;
  const tsconfigPath = path.join(root, "tsconfig.json");

  let configRaw: string;
  try {
    configRaw = await readFile(tsconfigPath, "utf8");
  } catch {
    return { kind: "skipped", reason: "v kořeni projektu není tsconfig.json (není to TypeScript projekt?)" };
  }

  const { ts, version } = await loadTs();

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

  deps.onStart?.(cmd.fileNames.length, version);

  const program = ts.createProgram(cmd.fileNames, options);
  // POZOR: getPreEmitDiagnostics NEvrací chyby konfigurace (cmd.errors). Kdybychom
  // je nepřidali, "extends na neexistující soubor" nebo neznámá volba by zmizely
  // a report by lhal "0 nálezů" nad rozbitým configem (tichý falešný úspěch).
  const diagnostics = [...configDiagnostics, ...ts.getPreEmitDiagnostics(program)];
  const findings = diagnostics.map((d) => toFinding(ts, d, root));
  const nodeModulesPresent = await hasNodeModules(root);

  // Verzi TS projektu jen ČTEME (data), abychom přiznali případný rozdíl proti
  // přibalené verzi. projectTsVersion vyplníme JEN když existuje a LIŠÍ SE – jinak
  // by report nesl zbytečnou „shodnou" poznámku.
  const projectTs = await readProjectTsVersion(root);
  const projectTsVersion = projectTs && projectTs !== version ? projectTs : undefined;

  return { kind: "ran", findings, fileCount: cmd.fileNames.length, nodeModulesPresent, tsVersion: version, projectTsVersion };
}

/**
 * Verze TypeScriptu, kterou MÁ projekt (z `node_modules/typescript/package.json`).
 * ČISTĚ ČTENÍ: `JSON.parse` textu package.json – data, NE spuštění modulu (na rozdíl
 * od `require("typescript")`; trojanizovaný package.json je inertní). Když projekt TS
 * nemá / soubor chybí / je nečitelný / bez `version` → `undefined` (poznámka se vynechá).
 */
async function readProjectTypescriptVersion(root: string): Promise<string | undefined> {
  try {
    const raw = await readFile(path.join(root, "node_modules", "typescript", "package.json"), "utf8");
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === "string" ? v : undefined;
  } catch {
    return undefined;
  }
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
