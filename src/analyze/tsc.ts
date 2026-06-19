import { realpathSync } from "node:fs";
import { readFile, realpath, stat } from "node:fs/promises";
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
  // Host místo ts.sys zadrží SEC-1 vektor 2: extends mimo root se přes něj nepřečte.
  const cmd = ts.parseJsonConfigFileContent(jsonParsed.config, containedParseHost(ts, root), configDir);

  // TS18003 = "v configu se nenašly žádné vstupní soubory" – to je STAV (prázdný
  // projekt), ne chyba configu. Oddělíme ho od SKUTEČNÝCH chyb konfigurace
  // (neznámá volba, extends na neexistující soubor, …), které do reportu PATŘÍ.
  const TS_NO_INPUTS = 18003;
  const configDiagnostics = cmd.errors.filter((e) => e.code !== TS_NO_INPUTS);

  // SEC-1 vektor 1: cmd.fileNames pochází z files/include, které jsou plně pod
  // kontrolou útočníka a SMÍ obsahovat ../ i absolutní cesty MIMO root. Takové by
  // createProgram níže přečetl z disku (probing FS + vtažení cizího obsahu do
  // reportu). Vyfiltrujeme je a každý vynechaný hlučně ohlásíme – ať jeden řádek
  // tsconfigu nezabije celou analýzu (DoS), ale uživatel pokus VIDÍ. isUnderRootReal
  // rozplete i symlink UVNITŘ root mířící VEN (realpath), ne jen literál cesty.
  const caseSensitive = ts.sys.useCaseSensitiveFileNames;
  const insideFiles: string[] = [];
  const outsideFiles: string[] = [];
  for (const fn of cmd.fileNames) {
    ((await isUnderRootReal(root, fn, caseSensitive)) ? insideFiles : outsideFiles).push(fn);
  }
  const containmentFindings: Finding[] = outsideFiles.map((fn) => ({
    source: "tsc",
    severity: "warning",
    message: `tsconfig odkazuje na soubor mimo kořen projektu – vynecháno z analýzy: ${toRelPosix(root, fn)}`,
  }));

  if (insideFiles.length === 0) {
    // config je, ale nezahrnul žádný soubor UVNITŘ root. Tři pravdivé důvody – ať
    // reason nelže (žádné "prázdný projekt", když útočník mířil ven).
    if (outsideFiles.length > 0) {
      return {
        kind: "skipped",
        reason: `tsconfig odkazoval jen na soubory mimo kořen projektu (${outsideFiles.length}) – uvnitř kořene není co analyzovat`,
      };
    }
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

  deps.onStart?.(insideFiles.length, version);

  // ZADRŽENO (fáze 28): createProgram dostává contained CompilerHost, který čtení
  // souborů omezí na root (+ přibalený lib). `import` i `/// <reference path>`
  // UVNITŘ zdrojáků už resolverem nesáhnou mimo root – cizí obsah se do reportu
  // nevtáhne (out-of-root cesta padne na TS2307, ne na přečtení). Spolu se SEC-1
  // (files/include filtr výše + extends přes containedParseHost) je tím tsconfig
  // i zdrojákový vektor pokrytý. Trade-off (fail-closed za důvěrnost): cokoli MIMO
  // root teď padne na "cannot find module" – nejen project-references/typeRoots, ale
  // i HOISTED závislosti (monorepo, kde `node_modules` leží o úroveň výš). Nad takovým
  // repem se report zaplaví falešnými TS2307; ve V1 vědomě analyzujeme jen tuto složku.
  const program = ts.createProgram(insideFiles, options, containedCompilerHost(ts, root, options));
  // POZOR: getPreEmitDiagnostics NEvrací chyby konfigurace (cmd.errors). Kdybychom
  // je nepřidali, "extends na neexistující soubor" nebo neznámá volba by zmizely
  // a report by lhal "0 nálezů" nad rozbitým configem (tichý falešný úspěch).
  const diagnostics = [...configDiagnostics, ...ts.getPreEmitDiagnostics(program)];
  const findings = [...diagnostics.map((d) => toFinding(ts, d, root)), ...containmentFindings];
  const nodeModulesPresent = await hasNodeModules(root);

  // Verzi TS projektu jen ČTEME (data), abychom přiznali případný rozdíl proti
  // přibalené verzi. projectTsVersion vyplníme JEN když existuje a LIŠÍ SE – jinak
  // by report nesl zbytečnou „shodnou" poznámku.
  const projectTs = await readProjectTsVersion(root);
  const projectTsVersion = projectTs && projectTs !== version ? projectTs : undefined;

  return { kind: "ran", findings, fileCount: insideFiles.length, nodeModulesPresent, tsVersion: version, projectTsVersion };
}

/**
 * Leží `candidate` uvnitř `root` (nebo JE root)? Po normalizaci absolutních cest.
 * Case-sensitivity respektuje FS (ts.sys.useCaseSensitiveFileNames) – na macOS/Windows
 * by jinak `/ROOT/x` prošlo jako "mimo" `/root`. Hranice je root sám nebo prefix
 * `root + path.sep`, ať `/root-evil` NEprojde jako podstrom `/root`. path.resolve
 * sjednotí i forward-slashe, které TS používá interně i na Windows.
 */
function isUnderRoot(root: string, candidate: string, caseSensitive: boolean): boolean {
  const fold = (p: string) => (caseSensitive ? p : p.toLowerCase());
  const r = fold(path.resolve(root));
  const c = fold(path.resolve(candidate));
  return c === r || c.startsWith(r + path.sep);
}

/**
 * Jako isUnderRoot, ale rozplete symlinky (realpath) na OBOU stranách. Bez toho by
 * soubor UVNITŘ root symlinkovaný VEN (`ln -s ../../etc/passwd link.ts` + files:
 * ["link.ts"]) prošel literálním testem a tsc by jeho cizí obsah vtáhl do reportu.
 * Realpath i rootu: když je sám pod symlinkem (např. /tmp → /private/tmp na macOS),
 * nesmí to dělat falešné negativy. FAIL-CLOSED: realpath selže (rozbitý symlink,
 * ENOENT, práva) → bereme jako MIMO root (radši vynechat než tiše přečíst).
 */
async function isUnderRootReal(root: string, candidate: string, caseSensitive: boolean): Promise<boolean> {
  if (!isUnderRoot(root, candidate, caseSensitive)) return false; // levný gate před realpathem
  try {
    return isUnderRoot(await realpath(root), await realpath(candidate), caseSensitive);
  } catch {
    return false;
  }
}

/** Synchronní varianta isUnderRootReal pro ParseConfigHost (host.readFile/fileExists jsou sync). */
function isUnderRootRealSync(root: string, candidate: string, caseSensitive: boolean): boolean {
  if (!isUnderRoot(root, candidate, caseSensitive)) return false;
  try {
    return isUnderRoot(realpathSync(root), realpathSync(candidate), caseSensitive);
  } catch {
    return false;
  }
}

/**
 * ParseConfigHost obalující ts.sys, který ČTENÍ souboru a test existence MIMO root
 * odmítne. Zadrží SEC-1 vektor 2: `extends` se resolvuje UVNITŘ parseJsonConfigFileContent
 * přes host.readFile – kdyby host pustil cizí cestu, tsc by přečetl libovolný soubor
 * mimo repo. Odmítnutý extends TS ohlásí jako chybu konfigurace (→ náš Finding).
 * isUnderRootRealSync rozplete i symlink mířící ven (symlinkovaný extends).
 * `readDirectory` necháme projít (legitimní include glob nerozbít) – může sice
 * enumerovat JMÉNA mimo root (slabý existence-oracle), ale OBSAH se nevtáhne: jeho
 * výsledky projdou filtrem fileNames výše. POZN.: lib/@types se přes tenhle host
 * NEčtou (jdou až přes createProgram s default hostem), takže je zadržení nerozbije.
 */
function containedParseHost(ts: typeof TS, root: string): TS.ParseConfigHost {
  const caseSensitive = ts.sys.useCaseSensitiveFileNames;
  return {
    useCaseSensitiveFileNames: caseSensitive,
    readDirectory: ts.sys.readDirectory.bind(ts.sys),
    fileExists: (p) => isUnderRootRealSync(root, p, caseSensitive) && ts.sys.fileExists(p),
    readFile: (p) => (isUnderRootRealSync(root, p, caseSensitive) ? ts.sys.readFile(p) : undefined),
  };
}

/**
 * CompilerHost obalující default host, který ČTENÍ souboru a test existence omezí
 * na kořen projektu (symlink-rozplet) NEBO přibalený TS lib adresář. Zadrží
 * zbytkový vektor SEC-1: `import "../../x"` i `/// <reference path="../../x" />`
 * UVNITŘ zdrojáků by jinak default hostem resolverem sáhly MIMO root a vtáhly cizí
 * obsah do reportu (únik důvěrnosti + probing FS).
 *
 * Gate sedí na ČTENÍ souboru (getSourceFile/readFile/fileExists/directoryExists) –
 * společný chokepoint pro VŠECHNY resolvery (modulový i `reference`). Proto NEladíme
 * resolveModuleNames: ten by `/// <reference path>` minul. readDirectory/getDirectories
 * NEhlídáme (stejně jako containedParseHost): smí enumerovat JMÉNA mimo root (slabý
 * existence-oracle), ale OBSAH se bez čtení nevtáhne.
 *
 * Lib adresář (lib.es*.d.ts) MUSÍ projít: leží v PŘIBALENÉM typescriptu MIMO root;
 * bez něj resolver nenajde Array/Promise/… a report se zaplaví falešnými chybami.
 * Lib se testuje literálně (isUnderRoot bez realpathu): je to NÁŠ instalační adresář,
 * útočník do něj nepíše → žádná symlink hra, a realpath by navíc rozbil lib pod
 * symlinkovaným node_modules (pnpm). realpath hostu NEpřepisujeme: případnou
 * symlink-ven canonicalizuje na cestu mimo root, kterou pak stejně zadrží gate čtení.
 *
 * FAIL-CLOSED: mimo povolené se soubor tváří jako NEEXISTUJÍCÍ → resolver to ohlásí
 * jako TS2307 "cannot find module" (hláška, NE obsah cizího souboru).
 */
function containedCompilerHost(ts: typeof TS, root: string, options: TS.CompilerOptions): TS.CompilerHost {
  const base = ts.createCompilerHost(options);
  const caseSensitive = ts.sys.useCaseSensitiveFileNames;
  const libDir = path.dirname(ts.getDefaultLibFilePath(options));
  const allowed = (p: string): boolean =>
    isUnderRoot(libDir, p, caseSensitive) || isUnderRootRealSync(root, p, caseSensitive);

  const getSourceFile: TS.CompilerHost["getSourceFile"] = (fileName, langOrOpts, onError, shouldCreate) =>
    allowed(fileName) ? base.getSourceFile(fileName, langOrOpts, onError, shouldCreate) : undefined;

  return {
    ...base,
    getSourceFile,
    fileExists: (fileName) => allowed(fileName) && base.fileExists(fileName),
    readFile: (fileName) => (allowed(fileName) ? base.readFile(fileName) : undefined),
    directoryExists: base.directoryExists
      ? (dirName) => allowed(dirName) && base.directoryExists!(dirName)
      : undefined,
  };
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
