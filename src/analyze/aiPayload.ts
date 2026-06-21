import type { FileEntry } from "../scan.js";
import { SOURCE_EXTENSIONS } from "./sourceExtensions.js";

/** Jeden soubor zahrnutý do payloadu pro AI + počet jeho řádků (pro kontrolu
 *  tvrzeného místa: nález na řádku > lineCount = halucinace). */
export interface PayloadFile {
  path: string;
  lineCount: number;
}

/**
 * Velikost OKNA pro AI dotaz ve znacích – z něj `splitAiPayload` odvodí počet částí
 * (efektivní okno části = `okno × CHUNK_FILL_RATIO`). POZOR: ve ZNACÍCH, ne v tokenech –
 * poměr ~3,3 znaku/token je hrubá heuristika, u hustého kódu jich může být víc.
 * ~1,65M znaků ≈ ~500k tokenů (u hustšího kódu i méně) – i s výstupem stále pod 1M
 * kontextem všech tří modelů (opus 4.8, sonnet 4.6, glm-5.2). Velký projekt se NEuřezává:
 * rozkrájí se na tolik částí, kolik je třeba, a pošle celý (cena roste s počtem částí,
 * odhad ji před během spočítá). Konstanta = kontrakt, ne konfig.
 */
export const AI_PAYLOAD_CHAR_BUDGET = 1_650_000;

/** Strop pro JEDEN soubor v bajtech – jeden obří generovaný soubor by jinak sám
 *  vyžral celý rozpočet. Vybírá se podle `FileEntry.size` (z scanu), bez čtení. */
export const AI_PAYLOAD_PER_FILE_MAX_BYTES = 100_000;

/**
 * Jakou ČÁST okna (`AI_PAYLOAD_CHAR_BUDGET`) smí krájené části nejvýš zaplnit. Rezerva
 * 25 % kryje (1) nepřesnost odhadu znaky↔tokeny (hustý kód má víc tokenů/znak), (2)
 * lost-in-the-middle (menší části = přesnější míření nálezů na řádek), (3) bezpečnostní
 * marži proti přetečení reálného tokenového okna modelu. „Plnit na max 75 %" (todo:
 * rozmezí 50–75 %, bereme horní mez). Efektivní okno děliče = `floor(budget × ratio)`.
 */
export const CHUNK_FILL_RATIO = 0.75;

/**
 * Výsledek výběru AI kandidátů: soubory, co půjdou do dotazu, a ty, které vypadly
 * kvůli per-file stropu (přiznají se v reportu, ne tiché vynechání).
 */
export interface AiCandidates {
  /** Vybrané zdrojové soubory pod per-file stropem, seřazené podle cesty (deterministicky). */
  selected: FileEntry[];
  /** Cesty ZDROJOVÝCH souborů nad per-file stropem (`AI_PAYLOAD_PER_FILE_MAX_BYTES`).
   *  NEzahrnuje minifikáty ani ne-zdroj – ty nejsou AI kandidáti, byl by to šum. */
  oversizedFiles: string[];
}

/**
 * JEDINÝ zdroj pravdy pro výběr souborů do AI vrstvy (volá ho `splitAiPayload`).
 * Vytažený zvlášť, aby šel testovat izolovaně a kontrakt výběru se nedriftoval.
 * Kandidát = soubor (ne adresář), ne minifikát, se zdrojovou příponou.
 * Z kandidátů per-file strop (`FileEntry.size`, bez čtení) vytřídí obří do
 * `oversizedFiles`. Řazení podle cesty = deterministické pořadí.
 */
export function selectAiCandidates(files: readonly FileEntry[]): AiCandidates {
  const candidates = files
    .filter((f) => f.type === "file" && !f.minified && SOURCE_EXTENSIONS.includes(f.ext))
    .sort((a, b) => a.path.localeCompare(b.path));

  const selected = candidates.filter((f) => f.size <= AI_PAYLOAD_PER_FILE_MAX_BYTES);
  const oversizedFiles = candidates.filter((f) => f.size > AI_PAYLOAD_PER_FILE_MAX_BYTES).map((f) => f.path);
  return { selected, oversizedFiles };
}

/** Slepí jeden soubor do payloadu s hlavičkou cesty. Formát = kontrakt pro AI dotaz
 *  (a pro odkazy na řádky v nálezech); změna ho mění pro všechny části. */
function formatFileChunk(path: string, content: string): string {
  return `// ==== ${path} ====\n${content}\n`;
}

/**
 * Počet řádků obsahu. POZOR na koncový `\n`: `"a\n".split("\n")` = `["a", ""]`
 * (délka 2), ale soubor má 1 řádek – proto koncový newline odečteme. Prázdný
 * soubor = 0 řádků. Přesný počet je důležitý pro kontrolu místa v `toFindings`
 * (nález na řádku > lineCount = halucinace) – o řádek volnější mez by halucinaci
 * na neexistujícím řádku N+1 pustila jako „ověřenou".
 */
function countLines(content: string): number {
  if (content === "") return 0;
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
}

/** Jedna část (chunk) pro samostatné AI volání: slepený kód + seznam zahrnutých
 *  souborů s počty řádků (kontrola místa proti halucinaci: nález na řádku > lineCount). */
export interface AiChunk {
  text: string;
  includedFiles: PayloadFile[];
}

/**
 * Výsledek krájení: pole částí (každá samostatný AI dotaz) a globálně vynechané
 * oversized soubory. ZÁMĚRNĚ bez `truncated`/`omitted*` – dělič NIC nezahazuje kvůli
 * celkové velikosti, to je celý smysl krájení; jediné vynechané jsou oversized soubory
 * (nad per-file stropem).
 */
export interface ChunkedPayload {
  chunks: AiChunk[];
  oversizedFiles: string[];
}

/**
 * Rozdělí AI kandidáty (sdílený `selectAiCandidates`) do částí pro krájené volání.
 * Strategie: ROVNOMĚRNÉ dělení, ne „plň po strop". Spočítá `N = ceil(total / window)`
 * (z délky payloadu VE ZNACÍCH, ne z bajtů `FileEntry.size` – měří se to, co se reálně
 * pošle) a cílí na části o velikosti ~`total/N`, aby žádná nevisela těsně pod oknem.
 *
 * `window` (ve znacích) je TVRDÁ horní mez: cíl `total/N` je jen měkká rovnováha, ale
 * okno se nepřekročí (jinak by API vstup uřízlo). Měkký cíl navíc NIKDY nevyrobí víc
 * částí než `N` (poslední část pobere zbytek); víc částí než `N` může vynutit jen
 * okno + zrnitost souborů (soubory se nekrájejí). Krájí se PO CELÝCH souborech –
 * rozseknutí by rozbilo číslování řádků (`lineCount` = obrana proti halucinaci).
 *
 * Přetékající soubor (sám > `window`) se NEzahodí: dostane vlastní (přeplněnou) část –
 * prošel per-file výběrem, tak patří dovnitř („první se do části zahrne vždy"). Reálně
 * s dnešními konstantami nenastane (per-file strop 100 kB << okno), ale `window` je
 * parametr, tak je to ošetřené.
 *
 * `window <= 0` je programová chyba volajícího → `RangeError` (ne tiché chování).
 * `readFile` dostává cestu RELATIVNÍ ke kořeni (jako `FileEntry.path`), čte se každý
 * vybraný soubor právě jednou (všechny jdou do nějaké části).
 */
export async function splitAiPayload(
  files: readonly FileEntry[],
  readFile: (relPath: string) => Promise<string>,
  window: number,
): Promise<ChunkedPayload> {
  if (!Number.isFinite(window) || window <= 0) {
    throw new RangeError(`splitAiPayload: window musí být kladné číslo, dostal ${window}`);
  }

  const { selected, oversizedFiles } = selectAiCandidates(files);
  if (selected.length === 0) return { chunks: [], oversizedFiles };

  // Přečti VŠECHNY vybrané (všechny jdou do nějaké části – nic se nezahazuje) a spočítej
  // délku každého slepeného bloku VE ZNACÍCH (s hlavičkou cesty, jako se reálně pošle).
  const pieces = await Promise.all(
    selected.map(async (f) => {
      const content = await readFile(f.path);
      const text = formatFileChunk(f.path, content);
      return { path: f.path, text, len: text.length, lineCount: countLines(content) };
    }),
  );

  const total = pieces.reduce((sum, p) => sum + p.len, 0);
  const n = Math.max(1, Math.ceil(total / window));
  const target = total / n;

  const chunks: AiChunk[] = [];
  let curText = "";
  let curFiles: PayloadFile[] = [];
  let curLen = 0;

  for (const p of pieces) {
    if (curLen === 0) {
      // Prázdná část: přidej vždy (i přeplněnou nad okno = single-file případ).
      curText = p.text;
      curFiles = [{ path: p.path, lineCount: p.lineCount }];
      curLen = p.len;
      continue;
    }

    const exceedsWindow = curLen + p.len > window;
    const reachedTarget = curLen >= target;
    // Měkký cíl uzavírá část jen pokud ještě POTŘEBUJEME další části (jinak by
    // rovnoměrnost vyrobila víc než N částí). Poslední část tak pobere zbytek.
    const moreChunksNeeded = chunks.length < n - 1;

    if (exceedsWindow || (reachedTarget && moreChunksNeeded)) {
      chunks.push({ text: curText, includedFiles: curFiles });
      curText = p.text;
      curFiles = [{ path: p.path, lineCount: p.lineCount }];
      curLen = p.len;
    } else {
      curText += p.text;
      curFiles.push({ path: p.path, lineCount: p.lineCount });
      curLen += p.len;
    }
  }
  chunks.push({ text: curText, includedFiles: curFiles });

  return { chunks, oversizedFiles };
}
