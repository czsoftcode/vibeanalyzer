import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import type { ChildPayload } from "./analyze/analyzeChild.js";
import { auditDependencies, type AuditResult } from "./audit.js";
import { analyzeESLint } from "./analyze/eslint.js";
import { ANALYSIS_TIMEOUT_MS, availableMemoryBytes, computeMemoryLimitMb } from "./analyze/limits.js";
import { buildModuleGraph, type ModuleGraphResult } from "./analyze/moduleGraph.js";
import { type IsolatedOutcome, runIsolated } from "./analyze/runIsolated.js";
import { analyzeTypeScript } from "./analyze/tsc.js";
import { defaultOutDir, parseArgs, validateTarget } from "./args.js";
import type { EslintResult, TscResult } from "./findings.js";
import { loadDirIgnore } from "./gitignore.js";
import { INTENT_HEADINGS, type Intent, loadIntent, parseIntent } from "./intent.js";
import { type AskFn, collectIntentDraft } from "./intentPrompt.js";
import { renderProjectMd, writeIntentFile } from "./intentWriter.js";
import { buildJsonIndex } from "./report/jsonIndex.js";
import { buildMarkdown } from "./report/markdown.js";
import { writeReportFiles } from "./report/writeOutputs.js";
import { type FileEntry, ROOT_UNREADABLE_MARKER, scanTree } from "./scan.js";
import { scanSecrets, type SecretsResult } from "./secrets.js";
import { fileTimestamp } from "./timestamp.js";
import { readPackageVersion } from "./version.js";

const HELP = `VibeAnalyzer – strukturální index projektu

Použití:
  vibeanalyzer [cesta] [--out <adresář>]

Argumenty:
  cesta            Složka k projití (výchozí: aktuální složka).

Volby:
  -o, --out <dir>  Kam uložit výstupy (výchozí: ~/.vibeanalyzer/<jméno projektu>).
  -h, --help       Zobrazí tuto nápovědu.
  -v, --version    Zobrazí verzi.

Výstup:
  vibeanalyzer-<timestamp>.json  strojový strukturální index
  vibeanalyzer-<timestamp>.md    lidský report se seznamem souborů a Mermaid diagramem`;

// Cesta k child skriptu pro izolovaný běh. Odvozená od PŘÍPONY tohoto modulu:
// v provozu běžíme z dist (cli.js → analyzeChild.js), v dev/testu ze src přes tsx
// (cli.ts → analyzeChild.ts). Nehledáme natvrdo "dist", ať to funguje v obojím.
const SELF_PATH = fileURLToPath(import.meta.url);
const SELF_EXT = path.extname(SELF_PATH); // ".js" v provozu, ".ts" pod tsx/vitest
const CHILD_PATH = path.join(path.dirname(SELF_PATH), "analyze", `analyzeChild${SELF_EXT}`);

/**
 * Izolace (fork) je DEFAULT – success criterion „report bez pádu" stojí na tom,
 * že OOM/zaseknutí strojové vrstvy shodí jen podproces, ne celý nástroj.
 * `VIBE_ANALYSIS_INPROCESS=1` ji vypne (běh v našem procesu) – únikový ventil pro
 * prostředí, kde fork nejde, a pro rychlé testy, které izolaci necílí (jinak by
 * každý běh forkoval node + načítal typescript → pomalé a paralelně se dusí).
 */
function shouldIsolate(): boolean {
  return process.env.VIBE_ANALYSIS_INPROCESS !== "1";
}

/** Node argumenty pro dítě: paměťový strop; ve vývoji (.ts) navíc tsx loader. */
function childExecArgv(memMb: number): string[] {
  const args = [`--max-old-space-size=${memMb}`];
  if (SELF_EXT === ".ts") args.unshift("--import", "tsx");
  return args;
}

const tscProgress = (fileCount: number, version?: string): string =>
  `Spouštím tsc (TS ${version}) nad ${fileCount} soubory – u velkého projektu může chvíli trvat…`;
const eslintProgress = (fileCount: number): string =>
  `Spouštím ESLint nad ${fileCount} soubory – u velkého projektu může chvíli trvat…`;

/**
 * Převede neúspěšný izolovaný běh na `skipped` s PRAVDIVÝM důvodem (tři odlišné
 * příčiny se nesmí slít). `ok` vrací null = „použij hodnotu z dítěte".
 */
export function skipFromOutcome(
  outcome: IsolatedOutcome<unknown>,
  layerLabel: string,
  memMb: number,
): { kind: "skipped"; reason: string } | null {
  switch (outcome.kind) {
    case "ok":
      return null;
    case "oom":
      return { kind: "skipped", reason: `projekt je příliš velký – ${layerLabel} překročil paměťový limit ${memMb} MB` };
    case "timeout":
      return {
        kind: "skipped",
        reason: `${layerLabel} trval příliš dlouho a byl přerušen (limit ${Math.round(ANALYSIS_TIMEOUT_MS / 1000)} s)`,
      };
    case "crashed":
      // bug v našem kódu (ne velikost/čas): nahlas na stderr se stackem, ať se pozná
      console.error(`Upozornění: ${layerLabel} v izolovaném procesu selhal a přeskočí se:\n${outcome.detail}`);
      return { kind: "skipped", reason: `${layerLabel} v izolovaném procesu selhal (viz stderr)` };
  }
}

/** tsc v odděleném procesu (limit paměti + čas). Pád/timeout → skipped, ne pád nástroje. */
async function analyzeTypeScriptIsolated(root: string): Promise<TscResult> {
  const memMb = computeMemoryLimitMb(availableMemoryBytes());
  const payload: ChildPayload = { layer: "tsc", root };
  const outcome = await runIsolated<TscResult>({
    childPath: CHILD_PATH,
    execArgv: childExecArgv(memMb),
    payload,
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    onStarted: (m) => console.log(tscProgress(m.fileCount, m.version)),
  });
  return skipFromOutcome(outcome, "tsc", memMb) ?? (outcome as { kind: "ok"; value: TscResult }).value;
}

/** ESLint v odděleném procesu (limit paměti + čas). Pád/timeout → skipped. */
async function analyzeESLintIsolated(root: string, files: FileEntry[]): Promise<EslintResult> {
  const memMb = computeMemoryLimitMb(availableMemoryBytes());
  const payload: ChildPayload = { layer: "eslint", root, files };
  const outcome = await runIsolated<EslintResult>({
    childPath: CHILD_PATH,
    execArgv: childExecArgv(memMb),
    payload,
    timeoutMs: ANALYSIS_TIMEOUT_MS,
    onStarted: (m) => console.log(eslintProgress(m.fileCount)),
  });
  return skipFromOutcome(outcome, "ESLint", memMb) ?? (outcome as { kind: "ok"; value: EslintResult }).value;
}

/**
 * Injektované závislosti pro interaktivní vytvoření záměru. Drží `run()`
 * testovatelný bez reálného stdin/TTY: testy podstrčí fake `ask`, `isInteractive`
 * a `homeDir`. Výchozí stav (prázdné `deps`) = NEinteraktivní: `run()` se nikdy
 * neptá a chová se jako dosud (žádná regrese stávajících testů, žádný hang v ne-TTY).
 */
export interface RunDeps {
  /** Dotazovač nad readline (bin.ts). Bez něj se nikdy neptáme. */
  ask?: AskFn;
  /** True jen když je stdin i stdout TTY – jinak nabídku vůbec nespustíme. */
  isInteractive?: boolean;
  /** Domov pro zápis záměru (test si podstrčí svůj; jinak safeHomedir v writeIntentFile). */
  homeDir?: string;
  /** Injektovatelný tsc analyzátor (test si podstrčí svůj; jinak reálný). */
  analyzeTs?: typeof analyzeTypeScript;
  /** Injektovatelný ESLint analyzátor (test si podstrčí svůj; jinak reálný). */
  analyzeES?: typeof analyzeESLint;
  /** Injektovatelný skener tajemství (test si podstrčí svůj; jinak reálný). */
  scanSecretsFn?: typeof scanSecrets;
  /** Injektovatelný audit závislostí (test si podstrčí svůj; jinak reálný npm audit). */
  auditFn?: typeof auditDependencies;
  /** Injektovatelný builder grafu modulů (test si podstrčí svůj; jinak reálný). */
  moduleGraphFn?: typeof buildModuleGraph;
}

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
  deps: RunDeps = {},
): Promise<number> {
  const parsed = parseArgs(argv, cwd);

  if (parsed.kind === "help") {
    console.log(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    console.log(await readPackageVersion());
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(`Chyba: ${parsed.message}\n`);
    console.error(HELP);
    return 2;
  }

  const { targetPath } = parsed;
  const outDir = parsed.outDir ?? defaultOutDir(homedir(), targetPath);

  // `--dev` má smysl jen s `--audit` (rozšiřuje audit o vývojové závislosti).
  // Samotné `--dev` je neúčinné – řekneme to nahlas, ať uživatel netápe, proč se
  // nic nestalo (ne tiché spolknutí volby).
  if (parsed.dev && !parsed.audit) {
    console.error("Pozn.: --dev nemá bez --audit žádný efekt (audit se nespustí). Použij --audit --dev.");
  }

  const valid = await validateTarget(targetPath);
  if (!valid.ok) {
    console.error(`Chyba: ${valid.message}`);
    return 1;
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const stamp = fileTimestamp(now);

  // ŽÁDNÝ try/catch kolem scanTree ZÁMĚRNĚ: scanTree je plně defenzivní – I/O
  // chyby (readdir/lstat/stat/realpath i čtení .gitignore přes loadDirIgnore) si
  // chytá sám a sype je do skippedUnreadable / gitignoreWarnings, na I/O tedy
  // nikdy nehodí. Jediné, co by hodil, je programová chyba (RangeError z hluboké
  // rekurze apod.) – a tu chceme nahlas se stackem přes launcher catch v bin.ts,
  // ne maskovanou jako „I/O selhání" bez stacku. Stejná úvaha jako u build*
  // (nález 3-7/3-11). Reálný TOCTOU (zmizelý cíl) řeší guard níž, ne výjimka.
  // .gitignore je VOLITELNÝ a čistě READ-ONLY (jen čteme). loadDirIgnore se volá
  // na KAŽDÉ vstoupené složce (kořen i podsložky) – co Git ignoruje (u Symfony
  // vendor/, var/cache/ …), do reportu nepatří a zbytečně by hltalo AI vrstvu;
  // vnořená pravidla platí pro svůj podstrom, hlubší má přednost (re-include přes !).
  // Chybějící/prázdný soubor = ticho (běžný stav); nečitelný/patologický =
  // upozornění a scan poběží bez TOHO .gitignore (degradaci hlásíme nahlas).
  // outDir může ležet uvnitř analyzované složky – ať se vlastní výstupní adresář
  // (a jeho obsah) nezapočítá do indexu.
  const result = await scanTree(targetPath, { excludePaths: new Set([outDir]), loadDirIgnore });

  // Degradace .gitignore (kořenového i vnořeného): každý problémový soubor vlastní
  // řádka na stderr. Scan už proběhl bez jeho pravidel – jen to neutajujeme.
  for (const w of result.gitignoreWarnings) {
    if (w.reason === "unreadable") {
      console.error(
        `Upozornění: našel jsem ${w.path}, ale nešel přečíst (${w.code}). ` +
          `Pravidla z tohoto .gitignore se nepoužijí – prošlo se i to, co by podle něj Git ignoroval.`,
      );
    } else {
      console.error(
        `Upozornění: ${w.path} obsahuje vzor, který nejde zpracovat. ` +
          `Pravidla z tohoto .gitignore se nepoužijí – prošlo se i to, co by podle něj Git ignoroval.`,
      );
    }
  }

  // scanTree je defenzivní: nečitelný cíl NEHODÍ, jen kořen zapíše do
  // skippedUnreadable jako ROOT_UNREADABLE_MARKER. To znamená, že se kořen vůbec
  // nepřečetl – analýza reálně neproběhla. Bez téhle kontroly by se zapsal report
  // o 0 souborech a vrátilo exit 0 (tichý falešný úspěch). Legitimně prázdná
  // (ale čitelná) složka marker v seznamu nemá, takže se nepleteme.
  if (result.skippedUnreadable.includes(ROOT_UNREADABLE_MARKER)) {
    console.error(`Chyba: cílovou složku nelze přečíst (zmizela nebo chybí práva?): ${targetPath}`);
    return 1;
  }

  const fileCount = result.files.filter((f) => f.type === "file").length;
  const dirCount = result.files.filter((f) => f.type === "dir").length;

  // .gitignore mohl odfiltrovat všechny SOUBORY (např. vzor "*", "*.php"). Hlídáme
  // počet souborů, ne result.files.length: vzor na soubory ("*.php") nechá v indexu
  // prázdné složky (files.length > 0), ale report nemá jediný soubor a pro analýzu
  // je bezcenný (nález 6-3). Report se přesto vytvoří (exit 0): kořen je čitelný,
  // jen není co analyzovat. Rozlišení "prázdné" vs "vše ignorováno" drží
  // ignoredByGitignore ze scanTree.
  if (fileCount === 0 && result.ignoredByGitignore > 0) {
    console.error(
      `Upozornění: .gitignore odfiltroval všechny soubory – index neobsahuje jediný soubor. ` +
        `Report se vytvoří, ale nebude co analyzovat.`,
    );
  }

  // Záměr je VOLITELNÝ: report jede dál i bez něj. Rozlišujeme tři stavy, ať se
  // "soubor není" (běžné) nepleť s "nešel přečíst" (problém k nahlášení).
  // READ-ONLY: do analyzovaného projektu nic nezapisujeme (non-goal č. 1) –
  // při chybějícím záměru jen poradíme, jak ho dodat.
  const intentResult = await loadIntent(targetPath, { homeDir: deps.homeDir });
  let intent: Intent | null = null;
  if (intentResult.kind === "loaded") {
    intent = intentResult.intent;
  } else if (intentResult.kind === "unreadable") {
    console.error(
      `Upozornění: našel jsem ${intentResult.path}, ale nešel přečíst (${intentResult.code}). ` +
        `Záměr se do reportu nedoplní.`,
    );
  } else if (intentResult.kind === "absent" && deps.isInteractive && deps.ask) {
    // Záměr NIKDE není a běžíme interaktivně (TTY na obou koncích) → nabídneme
    // vytvoření. JEN pro 'absent': u 'unreadable' už jsme varovali a u prázdného
    // skeletonu (kind=loaded bez obsahu) má .mini přednost, psát do home by report
    // stejně nepoužil. Vytvoření NESMÍ shodit běh – cokoli se pokazí, report jede dál.
    intent = await offerIntentCreation(deps.ask, targetPath, deps.homeDir);
  }

  // Nápověda se odvíjí od OBSAHU, ne od existence souboru: vypíšeme ji, když
  // z reportu nevyleze žádný použitelný záměr – tj. soubor chybí NEBO existuje,
  // ale obě sekce jsou prázdné/skeleton (nález 4-4: prázdný .mini/project.md
  // jinak tiše zastíní vyplněný fallback). U nečitelného souboru jsme už
  // varovali na stderr, tam nápovědu nepřidáváme. Chybějící záměr je běžný stav,
  // ne chyba → stdout (kontrakt "úspěch = ticho na stderr", cli.scanfail.test.ts).
  const hasIntentContent = intent !== null && (intent.building !== null || intent.nonGoals !== null);
  if (!hasIntentContent && intentResult.kind !== "unreadable") {
    console.log(
      `Tip: pro report se záměrem přidej do analyzovaného projektu \`.mini/project.md\` ` +
        `(nebo \`project.md\`) se sekcemi \`## ${INTENT_HEADINGS.building}\` a \`## ${INTENT_HEADINGS.nonGoals}\`.`,
    );
  }

  // Strojová typová analýza (tsc). Běží mezi scanem a buildem. tsc jen TYPUJE,
  // nic nespouští (non-goal č. 1). Očekávané cizí stavy (chybí/rozbitý tsconfig)
  // si analyzátor řeší sám a vrací skipped.
  //
  // REÁLNÝ běh jede v IZOLOVANÉM procesu (analyzeTypeScriptIsolated): tsc nad obřím
  // projektem může vyčerpat paměť (OOM) nebo se zaseknout, a to by žádný try/catch
  // tady nechytil (V8 by zabil celý proces). Ve forku spadne jen dítě a vrstvu
  // čistě označíme za přeskočenou s pravdivým důvodem (velikost / čas / pád).
  //
  // INJEKTOVANÝ analyzátor (deps.analyzeTs, jen testy) běží in-process jako dřív –
  // fork by injektáž obešel. Catch je pro NEČEKANÉ selhání toho injektovaného běhu.
  // realTsc = in-process analyzátor: buď injektovaný (testy), nebo reálný, když je
  // izolace vypnutá. Když je null → běžíme reálný tsc v izolovaném procesu.
  const realTsc = deps.analyzeTs ?? (shouldIsolate() ? null : analyzeTypeScript);
  let tsc: TscResult;
  if (realTsc) {
    try {
      tsc = await realTsc(targetPath, {
        onStart: (fileCount, version) => console.log(tscProgress(fileCount, version)),
      });
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`Upozornění: typová analýza (tsc) selhala a přeskočí se: ${e?.stack ?? e?.message ?? "neznámá chyba"}`);
      tsc = { kind: "skipped", reason: "tsc během analýzy selhal (viz stderr)" };
    }
  } else {
    tsc = await analyzeTypeScriptIsolated(targetPath);
  }

  // Strojová lint analýza (ESLint). Stejná logika jako tsc: reálný běh izolovaně
  // (analyzeESLintIsolated), injektovaný in-process. ESLint jen parsuje (kód
  // projektu se nevykoná), s naším configem – projektový eslint.config.js se ani
  // nehledá. Lintuje JEN soubory ze scanu (respektuje .gitignore).
  const realEs = deps.analyzeES ?? (shouldIsolate() ? null : analyzeESLint);
  let eslint: EslintResult;
  if (realEs) {
    try {
      eslint = await realEs(targetPath, result.files, {
        onStart: (fileCount) => console.log(eslintProgress(fileCount)),
      });
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`Upozornění: lint analýza (ESLint) selhala a přeskočí se: ${e?.stack ?? e?.message ?? "neznámá chyba"}`);
      eslint = { kind: "skipped", reason: "ESLint během analýzy selhal (viz stderr)" };
    }
  } else {
    eslint = await analyzeESLintIsolated(targetPath, result.files);
  }

  // Skener tajemství běží INLINE (ne v izolovaném procesu jako tsc/ESLint):
  // je to čistě read-only čtení souborů, nevykonává cizí kód ani nenačítá cizí
  // konfiguraci, takže izolace by jen přidala složitost. Plně defenzivní (nečitelný
  // soubor přeskočí, ne pád), ale catch tu necháváme pro NEČEKANÉ selhání, ať jeden
  // problém neshodí celý report – stejný princip jako u tsc/ESLint výš.
  const scanSecretsReal = deps.scanSecretsFn ?? scanSecrets;
  let secrets: SecretsResult;
  try {
    secrets = await scanSecretsReal(targetPath, result.files);
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`Upozornění: hledání tajemství selhalo a přeskočí se: ${e?.stack ?? e?.message ?? "neznámá chyba"}`);
    secrets = { kind: "skipped", reason: "skener tajemství během analýzy selhal (viz stderr)" };
  }

  // Audit závislostí je OPT-IN (--audit) a síťový. Bez --audit se vrstva čistě
  // přeskočí s konkrétním důvodem (ne tiché „čisto"). Stejný defenzivní catch jako
  // ostatní vrstvy: auditDependencies sám nepadá (mapuje chyby na skipped), catch je
  // pro NEČEKANÉ selhání, ať jeden problém neshodí celý report.
  let audit: AuditResult;
  if (parsed.audit) {
    const auditReal = deps.auditFn ?? auditDependencies;
    try {
      console.log("Audit závislostí (npm audit) běží…");
      audit = await auditReal(targetPath, { dev: parsed.dev });
    } catch (err: unknown) {
      const e = err as Error;
      console.error(`Upozornění: audit závislostí selhal a přeskočí se: ${e?.stack ?? e?.message ?? "neznámá chyba"}`);
      audit = { kind: "skipped", reason: "audit závislostí během běhu selhal (viz stderr)" };
    }
  } else {
    audit = { kind: "skipped", reason: "audit nevyžádán (spusť s --audit)" };
  }

  // Graf modulů běží INLINE jako skener tajemství: čistě read-only čtení +
  // parsování (cizí kód se NEvykoná, non-goal č. 1), žádná síť ani cizí config,
  // takže izolace by jen přidala složitost. Plně defenzivní (nečitelný/velký
  // soubor přeskočí, ne pád), catch je pro NEČEKANÉ selhání – ať jeden problém
  // neshodí celý report. Stejný princip jako u tsc/ESLint/secrets výš.
  const moduleGraphReal = deps.moduleGraphFn ?? buildModuleGraph;
  let moduleGraph: ModuleGraphResult;
  try {
    moduleGraph = await moduleGraphReal(targetPath, result.files);
  } catch (err: unknown) {
    const e = err as Error;
    console.error(`Upozornění: graf modulů selhal a přeskočí se: ${e?.stack ?? e?.message ?? "neznámá chyba"}`);
    moduleGraph = { kind: "skipped", reason: "graf modulů během sestavování selhal (viz stderr)" };
  }

  const index = buildJsonIndex(targetPath, generatedAt, result.files, tsc, eslint, secrets, audit, moduleGraph);
  const md = buildMarkdown({
    root: targetPath,
    generatedAt,
    files: result.files,
    skippedUnreadable: result.skippedUnreadable,
    intent,
    tsc,
    eslint,
    secrets,
    audit,
    moduleGraph,
  });

  const jsonPath = path.join(outDir, `vibeanalyzer-${stamp}.json`);
  const mdPath = path.join(outDir, `vibeanalyzer-${stamp}.md`);

  // outDir vytvoříme až TEĎ, těsně před zápisem. Dřívější selhání (neprojitelný
  // nebo nečitelný cíl) tak po sobě nenechají osiřelý prázdný výstupní adresář
  // (nález 3-9). Důsledek kompromisu: chybu nevytvořitelného outDir nahlásíme až
  // po scanu, ne hned – scan je levný a běžný případ projde.
  // mkdir s {recursive:true} vrací NEJVYŠŠÍ vytvořenou cestu (nebo undefined, když
  // nic nevzniklo, protože outDir už existoval). Tu hodnotu si držíme: je to přesně
  // to, co po sobě smíme uklidit při selhání zápisu – nic víc, nic míň.
  let createdDir: string | undefined;
  try {
    createdDir = await mkdir(outDir, { recursive: true });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    console.error(`Chyba: výstupní adresář nelze vytvořit: ${outDir} (${e.code ?? "neznámá chyba"})`);
    return 1;
  }

  try {
    await writeReportFiles(jsonPath, JSON.stringify(index, null, 2) + "\n", mdPath, md + "\n");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    // writeReportFiles zapisuje přes dočasné soubory (temp+rename), takže po
    // selhání uklidí best-effort jen své vlastní .tmp soubory – cílové reporty
    // nechá nedotčené. Adresáře, které jsme kvůli zápisu vytvořili (createdDir =
    // nejvyšší z nich, včetně mezičlánků u zanořeného --out), smažeme tady. Když
    // createdDir je undefined,
    // outDir existoval už před námi (klidně prázdný uživatelův) → NEMAŽEME nic,
    // ať neodstraníme cizí adresář ani staré reporty (nálezy 3-10/3-14/3-15).
    if (createdDir !== undefined) {
      await rm(createdDir, { recursive: true, force: true }).catch(() => {});
    }
    console.error(
      `Chyba: výstup nelze zapsat (${e.code ?? "neznámá chyba"}): ${e.message ?? ""}. ` +
        `Částečně zapsané soubory a adresáře, které jsem kvůli zápisu vytvořil, jsem zkusil uklidit (best-effort).`,
    );
    return 1;
  }

  console.log(`VibeAnalyzer: prošel jsem ${fileCount} souborů a ${dirCount} složek v ${targetPath}`);
  if (result.skippedUnreadable.length > 0) {
    console.log(`Přeskočeno (nečitelné): ${result.skippedUnreadable.length}`);
  }
  console.log(`JSON index: ${jsonPath}`);
  console.log(`MD report:  ${mdPath}`);
  return 0;
}

/** Odpověď na [a/N]: ano jen explicitní 'a/ano/y/yes'; null (EOF), prázdné i cokoli jiného = ne. */
function isYes(answer: string | null): boolean {
  return answer !== null && /^(a|ano|y|yes)$/i.test(answer.trim());
}

/**
 * Interaktivní nabídka vytvoření záměru. Vrací `Intent` k použití v TOMTO reportu,
 * nebo `null` (uživatel odmítl / zrušil / zápis selhal). NIKDY nehází ani nevrací
 * chybový kód – vytvoření záměru je nadstavba, která nesmí shodit hlavní běh.
 * Když vrátí null, volající dál vypíše běžný „Tip", jak záměr dodat ručně.
 *
 * READ-ONLY vůči analyzovanému projektu zůstává: writeIntentFile píše VÝHRADNĚ do
 * domova (`~/.vibeanalyzer/...`), ne do `targetPath`.
 */
async function offerIntentCreation(
  ask: AskFn,
  targetPath: string,
  homeDir: string | undefined,
): Promise<Intent | null> {
  const answer = await ask("Záměr projektu (project.md) nikde nenašel. Vytvořit ho teď? [a/N]");
  if (!isYes(answer)) return null; // ne / EOF / prázdné → bez záměru, padneme na Tip

  const collected = await collectIntentDraft(ask);
  if (collected.kind === "cancelled") {
    console.log("Vytvoření záměru zrušeno – pokračuju bez něj.");
    return null;
  }

  // Vyrenderujeme JEDNOU a stejný obsah jak zapíšeme, tak (při úspěchu) přečteme
  // zpět parserem do Intent – report tak ukazuje přesně to, co se uložilo.
  const content = renderProjectMd(collected.draft);
  const result = await writeIntentFile(targetPath, content, { homeDir });
  switch (result.kind) {
    case "written":
      console.log(`Záměr uložen do ${result.path}. Použiju ho i pro tenhle report.`);
      return parseIntent(content, result.path);
    case "exists":
      // Mezi loadIntent a zápisem soubor vznikl (TOCTOU) – nepřepisujeme cizí.
      console.log(`Záměr už mezitím existuje (${result.path}) – nepřepisuji, použij ho příště.`);
      return null;
    case "unwritable":
      console.error(
        `Upozornění: záměr nešlo uložit (${result.code}): ${result.path}. Report vznikne bez něj.`,
      );
      return null;
    case "no-home":
      console.error(
        "Upozornění: neznámý domovský adresář – záměr nelze uložit. Report vznikne bez něj.",
      );
      return null;
  }
}

