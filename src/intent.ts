import { readFile } from "node:fs/promises";
import * as path from "node:path";

/**
 * Pevné nadpisy sekcí, jak je generuje `mini init` do project.md. Jsou to
 * KONTRAKTNÍ literály mezi analyzovaným projektem (mini) a tímhle parserem;
 * sdílí je i nápověda v cli.ts, aby se text na jednom místě nerozešel s druhým.
 * Když mini nadpisy přejmenuje, parser sekci tiše nenajde → degraduje na
 * "nedodáno" (viz loadIntent/parseIntent), report nespadne.
 */
export const INTENT_HEADINGS = {
  building: "What I'm building",
  nonGoals: "Non-goals",
} as const;

/** Záměr projektu načtený z project.md analyzovaného projektu. */
export interface Intent {
  /** Text sekce "What I'm building"; null = sekce chybí nebo je prázdná. */
  building: string | null;
  /** Položky sekce "Non-goals"; null = sekce chybí nebo nemá žádnou položku. */
  nonGoals: string[] | null;
  /** Cesta k souboru, ze kterého se záměr načetl (absolutní). */
  sourcePath: string;
}

/**
 * Výsledek pokusu o načtení záměru. Záměrně rozlišujeme tři stavy, ať se
 * "soubor prostě není" (běžný legitimní stav) nemaskuje za "nešel přečíst"
 * (problém k nahlášení) a naopak.
 */
export type IntentResult =
  | { kind: "loaded"; intent: Intent }
  | { kind: "absent" }
  | { kind: "unreadable"; path: string; code: string };

/**
 * Najde a načte záměr v analyzovaném projektu. Pořadí: `<cíl>/.mini/project.md`,
 * pak fallback `<cíl>/project.md`. Čistě READ-ONLY – do analyzovaného projektu
 * nic nezapisuje.
 *
 * - oba kandidáti chybí (ENOENT) → `absent`,
 * - kandidát existuje, ale nejde přečíst (práva, je to adresář, …) →
 *   `unreadable` (nehledáme dál, ať reálný problém s právy nezmizí za fallbackem),
 * - kandidát přečten → `loaded` (parsování řeší parseIntent; chybové stavy sekcí
 *   se promítnou do Intent.building/nonGoals = null, nehází se).
 */
export async function loadIntent(targetPath: string): Promise<IntentResult> {
  const candidates = [
    path.join(targetPath, ".mini", "project.md"),
    path.join(targetPath, "project.md"),
  ];

  for (const candidate of candidates) {
    let content: string;
    try {
      content = await readFile(candidate, "utf8");
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") continue; // soubor není → zkus dalšího kandidáta
      return { kind: "unreadable", path: candidate, code: e.code ?? "neznámá chyba" };
    }
    return { kind: "loaded", intent: parseIntent(content, candidate) };
  }

  return { kind: "absent" };
}

/**
 * Z obsahu project.md vytáhne jen dvě sekce (záměr + non-goaly). Ostatní sekce
 * (Approach, Success criteria, …) ignoruje. Chybějící i prázdná sekce → null,
 * NIKDY prázdný string – ať "nedodáno" zůstane viditelný stav, ne tichá díra.
 */
export function parseIntent(content: string, sourcePath: string): Intent {
  return {
    building: extractText(content, INTENT_HEADINGS.building),
    nonGoals: extractList(content, INTENT_HEADINGS.nonGoals),
    sourcePath,
  };
}

/** Řádek otevírá/zavírá code fence (``` nebo ~~~). */
function isFenceLine(line: string): boolean {
  return /^(?:`{3,}|~{3,})/.test(line.trim());
}

/** Sourozenecký nadpis úrovně 2 (`## `). Předěl mezi sekcemi project.md. */
function isSiblingHeading(line: string): boolean {
  return /^##\s/.test(line.trim());
}

/**
 * Vrátí řádky bloku pod nadpisem `## <heading>` až do dalšího sourozeneckého
 * nadpisu `## `. null = nadpis se v obsahu nenašel; prázdné pole = nadpis je,
 * ale blok je prázdný.
 *
 * Hledání startu i konce IGNORUJE řádky uvnitř code fence a předěl bere jen na
 * `## ` (úroveň 2), ne na každém `#` řádku. Bez toho by `#` v próze nebo
 * `## Non-goals` v ukázce uvnitř ``` bloku tiše uřízly/zfalšovaly sekci
 * (nálezy 4-1, 4-3). NENÍ to plný markdown parser – jen tolik povědomí o
 * struktuře, aby parser netvořil zavádějící obsah.
 */
function sectionLines(content: string, heading: string): string[] | null {
  const lines = content.split(/\r?\n/);
  const target = `## ${heading}`;

  let inFence = false;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.trim() === target) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return null;

  // start leží těsně za nadpisem, který byl MIMO fence → blok čteme se stavem
  // inFence = false.
  const block: string[] = [];
  inFence = false;
  for (let i = start; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      block.push(line);
      continue;
    }
    if (!inFence && isSiblingHeading(line)) break;
    block.push(line);
  }
  return block;
}

/** Sekci přečte jako souvislý text (víceřádkově). Prázdné → null. */
function extractText(content: string, heading: string): string | null {
  const block = sectionLines(content, heading);
  if (block === null) return null;
  const text = block.join("\n").trim();
  return text.length === 0 ? null : text;
}

/**
 * Sekci přečte jako seznam (řádky `- ` / `* `). Odrážky UVNITŘ code fence
 * (ukázka kódu) se neberou jako non-goaly (nález 4-3). Žádná položka → null.
 */
function extractList(content: string, heading: string): string[] | null {
  const block = sectionLines(content, heading);
  if (block === null) return null;
  const items: string[] = [];
  let inFence = false;
  for (const line of block) {
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^\s*[-*]\s+(.*\S)\s*$/.exec(line);
    if (m) items.push(m[1] ?? "");
  }
  return items.length === 0 ? null : items;
}
