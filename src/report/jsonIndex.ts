import type { AiReport } from "../analyze/aiStatus.js";
import type { ModuleGraphResult } from "../analyze/moduleGraph.js";
import type { AuditResult } from "../audit.js";
import type { EslintResult, TscResult } from "../findings.js";
import type { FileEntry } from "../scan.js";
import type { SecretsResult } from "../secrets.js";

/**
 * Strojový strukturální index. Od verze 2 nese výsledek tsc vrstvy (`tsc`), od
 * verze 3 i ESLint vrstvy (`eslint`), od verze 5 i skeneru tajemství (`secrets`),
 * od verze 6 i auditu závislostí (`audit`), od verze 7 i graf modulů
 * (`moduleGraph`) – celé diskriminované výsledky, ne jen pole nálezů, aby ze
 * strojového výstupu šlo poznat i "přeskočeno" vs "čistý projekt" (jinak by i
 * JSON tiše lhal). Od verze 8 nese každý `files[]` příznak `minified` (jméno
 * `*.min.<ext>`) a `moduleGraph.minified` počítadlo z grafu vyřazených minifikátů.
 * Od verze 9 nese `secrets.skipped` počty záměrně přeskočených souborů skeneru
 * tajemství (minifikáty / velké / binárky / dlouhé řádky) – aby ani JSON tiše
 * nevynechával balast. Od verze 10 nese `tsc` (ran) příznak `hoistedNodeModules`
 * (kořen bez `node_modules`, ale leží výš – monorepo; fail-closed analýza může dát
 * falešné TS2307). Od verze 11 nese stav AI vrstvy (`ai`). Od verze 12 má `ai` i
 * variantu `verified` (levný testovací dotaz, `--ai-check`). Od verze 13 má i
 * variantu `analyzed` (reálná analýza non-goalů přes `--ai`): nese `findings`,
 * skutečnou `usage` (tokeny) a `costUsd` (odhad ceny). Od verze 14 je `ai` SOUHRN
 * dvou nezávislých režimů (`nonGoal` přes `--ai-non-goal`, `code` přes `--ai-code`),
 * každý vlastní `AiStatus` – dřív byl `ai` jediný `AiStatus`. Od verze 15 nese `ai`
 * i třetí režim `logic` (`--ai-logic`): analýza funkčnosti kódu jako celku vůči záměru.
 * Od verze 16 nese `ai` i `oversizedFiles` – zdrojové soubory vynechané z AI kvůli
 * per-file stropu (přizná, co AI nevidělo; přítomné jen když běžel analytický režim).
 * Od verze 17 neslo `ai` i `truncation`. Od verze 18 je `truncation` PRYČ – krájený AI
 * běh nic neuřezává (velký projekt se pošle celý po částech); místo toho má `ai` nepovinné
 * `chunking` s per-režim metadaty krájení (`nonGoal`/`code`/`logic` → {total, failed,
 * reasons}: na kolik částí se projekt rozdělil a kolik jich v daném režimu selhalo).
 *
 * POZOR: `secrets.findings[].message` nese jen MASKOVANÝ náznak (prefix + délka),
 * nikdy celou hodnotu tajemství – JSON je perzistovaný artefakt jako `.md`.
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
  /** výsledek skeneru tajemství (klíče, tokeny) */
  secrets: SecretsResult;
  /** výsledek auditu závislostí (npm audit); přeskočeno, když není --audit */
  audit: AuditResult;
  /** graf importních závislostí mezi zdrojovými soubory */
  moduleGraph: ModuleGraphResult;
  /** souhrn AI vrstvy: tři nezávislé režimy (`nonGoal` přes --ai-non-goal, `code` přes
   *  --ai-code, `logic` přes --ai-logic), každý vlastní AiStatus (ready/verified/analyzed/skipped);
   *  + nepovinné `oversizedFiles` (soubory vynechané z AI kvůli per-file stropu) a `chunking`
   *  (per-režim metadata krájení: na kolik částí projekt rozdělen a kolik jich selhalo) */
  ai: AiReport;
}

/** Bump 17 → 18: `ai` už NEMÁ `truncation` (krájený běh nic neuřezává), místo toho nese
 *  nepovinné `chunking` (per-režim metadata krájení). Změna tvaru = kontrakt s konzumenty JSON. */
export const INDEX_VERSION = 18;

export function buildJsonIndex(
  root: string,
  generatedAt: string,
  files: FileEntry[],
  tsc: TscResult,
  eslint: EslintResult,
  secrets: SecretsResult,
  audit: AuditResult,
  moduleGraph: ModuleGraphResult,
  ai: AiReport,
): JsonIndex {
  return {
    version: INDEX_VERSION,
    generatedAt,
    root,
    files,
    tsc,
    eslint,
    secrets,
    audit,
    moduleGraph,
    ai,
  };
}
