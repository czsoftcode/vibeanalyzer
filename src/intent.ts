import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { homeIntentPath, safeHomedir } from "./projectPaths.js";

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
  /**
   * Syrový text celého project.md MINUS sekce "Non-goals" (záměr i ostatní sekce
   * jako Approach/Success criteria/Main constraints v něm ZŮSTÁVAJÍ). Slouží jako
   * úplný deklarovaný kontext pro AI prompty. Non-goaly se vyřezávají, protože do
   * promptu jdou zvlášť jako číslovaný seznam (adresování `nonGoalIndex`) – jinak by
   * tam byly dvakrát. null = po vyříznutí nezbyl žádný text (project.md byl prázdný
   * nebo obsahoval jen non-goaly).
   */
  context: string | null;
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
 * Najde a načte záměr. Pořadí: `<cíl>/.mini/project.md`, pak `<cíl>/project.md`,
 * pak mimo cíl `~/.vibeanalyzer/<projectKey>/project.md`. Čistě READ-ONLY – nikam
 * (ani do cíle, ani do `~/.vibeanalyzer`) nic nezapisuje.
 *
 * - všichni kandidáti chybí (ENOENT) → `absent`,
 * - kandidát existuje, ale nejde přečíst (práva, je to adresář, …) →
 *   `unreadable` (nehledáme dál, ať reálný problém s právy nezmizí za fallbackem),
 * - kandidát přečten → `loaded` (parsování řeší parseIntent; chybové stavy sekcí
 *   se promítnou do Intent.building/nonGoals = null, nehází se).
 *
 * `options.homeDir` umožní v testech podstrčit jiný domov (jinak `os.homedir()`).
 * Prázdný řetězec = "domov neznámý" → domácí kandidát se přeskočí.
 */
export async function loadIntent(
  targetPath: string,
  options: { homeDir?: string } = {},
): Promise<IntentResult> {
  const homeDir = options.homeDir ?? safeHomedir();
  const candidates = [
    path.join(targetPath, ".mini", "project.md"),
    path.join(targetPath, "project.md"),
    homeIntentPath(homeDir, targetPath),
  ].filter((candidate): candidate is string => candidate !== null);

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
    context: extractContext(content),
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
 * Najde rozsah sekce `## <heading>` v už rozdělených řádcích: index řádku NADPISU
 * (`headingIdx`) a index prvního řádku ZA sekcí (`endIdx` = další sourozenecký `## `
 * nebo konec). null = nadpis se nenašel.
 *
 * Hledání startu i konce IGNORUJE řádky uvnitř code fence a předěl bere jen na
 * `## ` (úroveň 2), ne na každém `#` řádku. Bez toho by `#` v próze nebo
 * `## Non-goals` v ukázce uvnitř ``` bloku tiše uřízly/zfalšovaly sekci
 * (nálezy 4-1, 4-3). NENÍ to plný markdown parser – jen tolik povědomí o
 * struktuře, aby parser netvořil zavádějící obsah. Sdílí ho čtení sekcí
 * (`sectionLines`) i vyříznutí sekce (`stripSection`), ať se obě cesty drží
 * stejné definice „kde sekce končí".
 */
function findSectionRange(
  lines: string[],
  heading: string,
): { headingIdx: number; endIdx: number } | null {
  const target = `## ${heading}`;

  let inFence = false;
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && line.trim() === target) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) return null;

  // konec hledáme od řádku ZA nadpisem; nadpis byl MIMO fence → start inFence = false.
  inFence = false;
  let endIdx = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (isFenceLine(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && isSiblingHeading(line)) {
      endIdx = i;
      break;
    }
  }
  return { headingIdx, endIdx };
}

/**
 * Vrátí řádky bloku pod nadpisem `## <heading>` až do dalšího sourozeneckého
 * nadpisu `## `. null = nadpis se v obsahu nenašel; prázdné pole = nadpis je,
 * ale blok je prázdný.
 */
function sectionLines(content: string, heading: string): string[] | null {
  const lines = content.split(/\r?\n/);
  const range = findSectionRange(lines, heading);
  if (range === null) return null;
  // headingIdx+1 přeskočí nadpis, endIdx je první řádek ZA sekcí (exkluzivně).
  return lines.slice(range.headingIdx + 1, range.endIdx);
}

/**
 * Vrátí obsah s ODSTRANĚNOU sekcí `## <heading>` (nadpis i její tělo až po další
 * `## `). Sekce se nenašla → obsah beze změny. Stejné povědomí o fence/předělech
 * jako `sectionLines` (sdílený `findSectionRange`), ať vyříznutí nepadne na
 * `## <heading>` uvnitř code fence.
 */
function stripSection(content: string, heading: string): string {
  const lines = content.split(/\r?\n/);
  const range = findSectionRange(lines, heading);
  if (range === null) return content;
  const kept = [...lines.slice(0, range.headingIdx), ...lines.slice(range.endIdx)];
  return kept.join("\n");
}

/**
 * Sestaví `context`: celý project.md MINUS sekce Non-goals (jde do promptu zvlášť
 * jako číslovaný seznam). Záměr i ostatní sekce zůstávají. Po vyříznutí trimne
 * krajní bílé znaky; prázdné → null (ať „není kontext" zůstane viditelný stav,
 * ne prázdný řetězec, který by v promptu udělal prázdný nadpis).
 */
function extractContext(content: string): string | null {
  const stripped = stripSection(content, INTENT_HEADINGS.nonGoals).trim();
  return stripped.length === 0 ? null : stripped;
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
