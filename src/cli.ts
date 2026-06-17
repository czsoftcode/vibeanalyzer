import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import process from "node:process";
import { defaultOutDir, parseArgs, validateTarget } from "./args.js";
import { type GitignorePredicate, loadGitignore } from "./gitignore.js";
import { INTENT_HEADINGS, type Intent, loadIntent } from "./intent.js";
import { buildJsonIndex } from "./report/jsonIndex.js";
import { buildMarkdown } from "./report/markdown.js";
import { writeReportFiles } from "./report/writeOutputs.js";
import { ROOT_UNREADABLE_MARKER, scanTree } from "./scan.js";
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

export async function run(
  argv: readonly string[] = process.argv.slice(2),
  cwd: string = process.cwd(),
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

  const valid = await validateTarget(targetPath);
  if (!valid.ok) {
    console.error(`Chyba: ${valid.message}`);
    return 1;
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const stamp = fileTimestamp(now);

  // ŽÁDNÝ try/catch kolem scanTree ZÁMĚRNĚ: scanTree je plně defenzivní – I/O
  // chyby (readdir/lstat/stat/realpath) si chytá sám a sype je do
  // skippedUnreadable, na I/O tedy nikdy nehodí. Jediné, co by hodil, je
  // programová chyba (RangeError z hluboké rekurze apod.) – a tu chceme nahlas
  // se stackem přes launcher catch v bin.ts, ne maskovanou jako „I/O selhání"
  // bez stacku. Stejná úvaha jako u build* (nález 3-7/3-11). Reálný TOCTOU
  // (zmizelý cíl) řeší guard níž, ne výjimka.
  // .gitignore je VOLITELNÝ a čistě READ-ONLY (jen čteme). Kořenový
  // <cíl>/.gitignore necháme prořezat index – co Git ignoruje (u Symfony
  // vendor/, var/cache/ …), do reportu nepatří a zbytečně by hltalo AI vrstvu.
  // Chybějící soubor = ticho (běžný stav); nečitelný = upozornění a scan poběží
  // bez něj (degradaci hlásíme nahlas, netváříme se, že .gitignore platil).
  const gitignore = await loadGitignore(targetPath);
  let isIgnored: GitignorePredicate | undefined;
  if (gitignore.kind === "loaded") {
    isIgnored = gitignore.isIgnored;
  } else if (gitignore.kind === "unreadable") {
    console.error(
      `Upozornění: našel jsem ${gitignore.path}, ale nešel přečíst (${gitignore.code}). ` +
        `.gitignore se nepoužije – prošlo se i to, co by Git ignoroval.`,
    );
  } else if (gitignore.kind === "invalid") {
    // Soubor se přečetl, ale obsahuje vzor, který knihovna neumí zkompilovat
    // (matcher by házel). Degradujeme nahlas a scan poběží bez .gitignore –
    // ne pád celé analýzy (nález 6-1).
    console.error(
      `Upozornění: ${gitignore.path} obsahuje vzor, který nejde zpracovat. ` +
        `.gitignore se nepoužije – prošlo se i to, co by Git ignoroval.`,
    );
  }

  // outDir může ležet uvnitř analyzované složky – ať se vlastní výstupní adresář
  // (a jeho obsah) nezapočítá do indexu.
  const result = await scanTree(targetPath, { excludePaths: new Set([outDir]), isIgnored });

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
  const intentResult = await loadIntent(targetPath);
  let intent: Intent | null = null;
  if (intentResult.kind === "loaded") {
    intent = intentResult.intent;
  } else if (intentResult.kind === "unreadable") {
    console.error(
      `Upozornění: našel jsem ${intentResult.path}, ale nešel přečíst (${intentResult.code}). ` +
        `Záměr se do reportu nedoplní.`,
    );
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

  const index = buildJsonIndex(targetPath, generatedAt, result.files);
  const md = buildMarkdown({
    root: targetPath,
    generatedAt,
    files: result.files,
    skippedUnreadable: result.skippedUnreadable,
    intent,
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
    // writeReportFiles uklidí best-effort jen částečně zapsané SOUBORY. Adresáře,
    // které jsme kvůli zápisu vytvořili (createdDir = nejvyšší z nich, včetně
    // mezičlánků u zanořeného --out), smažeme tady. Když createdDir je undefined,
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

