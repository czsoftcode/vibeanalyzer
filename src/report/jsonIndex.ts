import type { AiStatus } from "../analyze/aiStatus.js";
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
 * variantu `verified` (reálný testovací dotaz na API proběhl, jen s `--ai-check`)
 * vedle `ready` (klíč je, dotaz neproběhl) a `skipped` (chybí klíč / síť / odmítnutí).
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
  /** stav AI vrstvy: ready = klíč nalezen (dotaz neproběhl), verified = dotaz na
   *  API proběhl (--ai-check), skipped = důvod přeskočení (chybí klíč / síť / 401) */
  ai: AiStatus;
}

/** Bump 11 → 12: `ai` má novou variantu `verified` (reálné ověření přes --ai-check).
 *  Rozšíření tvaru unie = kontrakt s konzumenty JSON. */
export const INDEX_VERSION = 12;

export function buildJsonIndex(
  root: string,
  generatedAt: string,
  files: FileEntry[],
  tsc: TscResult,
  eslint: EslintResult,
  secrets: SecretsResult,
  audit: AuditResult,
  moduleGraph: ModuleGraphResult,
  ai: AiStatus,
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
