/**
 * Sdílený datový model strojového nálezu. Záměrně samostatný modul: kontrakt
 * mezi analyzátorem (produkuje nálezy), JSON indexem a Markdown reportem (oba je
 * vykreslují). Pozdější ESLint i AI vrstva se nabalí sem, ne každá zvlášť.
 */

/** Který nástroj nález vyrobil. (AI vrstva rozšíří v dalších fázích.) */
export type FindingSource = "tsc" | "eslint" | "secret" | "audit";

/** Závažnost nálezu, sjednocená napříč nástroji. */
export type Severity = "error" | "warning" | "info";

/**
 * Jeden strojový nález.
 *
 * `file`/`line`/`column` jsou VOLITELNÉ a to je podstatné: některé diagnostiky
 * (typicky globální chyby konfigurace tsc) nemají místo v žádném souboru. Kdyby
 * byly povinné, spadli bychom na nich. `line`/`column` jsou 1-based (lidské).
 */
export interface Finding {
  source: FindingSource;
  severity: Severity;
  /** cesta relativní ke kořeni projektu, oddělovač vždy "/"; chybí u globálních chyb */
  file?: string;
  /** 1-based číslo řádku; chybí, když chybí `file` */
  line?: number;
  /** 1-based sloupec; chybí, když chybí `file` */
  column?: number;
  /** identifikátor pravidla – u tsc kód diagnostiky, např. "TS2322" */
  rule?: string;
  message: string;
}

/**
 * Výsledek tsc vrstvy. Diskriminovaný union – DŮLEŽITÉ rozlišení: "ran s 0 nálezy"
 * (vrstva proběhla, projekt je čistý) se NESMÍ splést s "skipped" (vrstva vůbec
 * neproběhla). Sloučení obojího do "v reportu nic není" = tichý falešný úspěch.
 */
export type TscResult =
  | { kind: "skipped"; reason: string }
  | {
      kind: "ran";
      findings: Finding[];
      /** počet souborů, které tsc zahrnul (z tsconfigu) */
      fileCount: number;
      /**
       * Byl v projektu `node_modules`? Když ne, chyby nenalezených modulů
       * (TS2307 ap.) jsou očekávané a report to musí přiznat, ne vydávat za bug.
       */
      nodeModulesPresent: boolean;
      /**
       * Kořen NEMÁ `node_modules`, ale některý jeho PŘEDEK ano (hoisted závislosti
       * – monorepo). Contained host (fáze 28) je fail-closed → importy balíčků padnou
       * na TS2307; report to musí přiznat jako možný artefakt analýzy, ne chybu kódu.
       * Když kořen `node_modules` MÁ, je `false` (walk se vůbec nespustí).
       */
      hoistedNodeModules: boolean;
      /** verze PŘIBALENÉHO TypeScriptu, kterou se typovalo (vždy se použije náš TS) */
      tsVersion: string;
      /**
       * Verze TS deklarovaná projektem – JEN když existuje a LIŠÍ SE od `tsVersion`.
       * Report ji přizná, ať se nálezy posuzují s vědomím možného verzního rozdílu
       * (typujeme naší verzí, ne projektovou – non-goal č. 1, viz loadTypescript).
       */
      projectTsVersion?: string;
    };

/**
 * Výsledek ESLint vrstvy. Stejný kontrakt jako TscResult: "ran s 0 nálezy"
 * (čistý projekt) se NESMÍ splést s "skipped" (vrstva neproběhla – žádné JS/TS
 * soubory nebo interní selhání). Bez `nodeModulesPresent` – ESLint běží s naším
 * configem, na node_modules projektu nezáleží.
 */
export type EslintResult =
  | { kind: "skipped"; reason: string }
  | {
      kind: "ran";
      findings: Finding[];
      /** počet souborů, které ESLint zkontroloval */
      fileCount: number;
      /** počet souborů vynechaných z lintu jako minifikáty (`*.min.*`) – generovaný
       *  kód, ne zdroj psaný uživatelem; vykazuje se v reportu, ať není vynechání tiché */
      skippedMinified: number;
    };

/**
 * Lidské "soubor:řádek:sloupec" pro report. Sdílené místo, aby md i případný
 * další renderer formátovaly umístění stejně (kontrakt + test, ne kopie).
 * Degraduje podle toho, co je k dispozici: až po "(bez umístění)" u globální chyby.
 */
export function formatLocation(f: Finding): string {
  if (f.file === undefined) return "(bez umístění)";
  if (f.line === undefined) return f.file;
  if (f.column === undefined) return `${f.file}:${f.line}`;
  return `${f.file}:${f.line}:${f.column}`;
}
