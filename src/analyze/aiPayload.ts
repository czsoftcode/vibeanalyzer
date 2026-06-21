import type { FileEntry } from "../scan.js";
import { SOURCE_EXTENSIONS } from "./sourceExtensions.js";

/** Jeden soubor zahrnutý do payloadu pro AI + počet jeho řádků (pro kontrolu
 *  tvrzeného místa: nález na řádku > lineCount = halucinace). */
export interface PayloadFile {
  path: string;
  lineCount: number;
}

/**
 * Payload pro AI vrstvu: slepený zdrojový kód s hlavičkami cest, seznam zahrnutých
 * souborů a příznak `truncated` (uřízli jsme nad stropem – v reportu se PŘIZNÁ, ne
 * tiché vynechání).
 */
export interface AiPayload {
  text: string;
  includedFiles: PayloadFile[];
  truncated: boolean;
  /** Počet souborů, které se kvůli celkovému stropu (`AI_PAYLOAD_CHAR_BUDGET`) do dotazu
   *  NEvešly (na rozdíl od `oversizedFiles` to jsou jinak validní kandidáti pod per-file
   *  stropem, jen došel celkový rozpočet). 0 když `truncated === false`. Slouží reportu,
   *  ať uživatel ví, KOLIK kódu AI nevidělo, ne jen ŽE něco. */
  omittedFiles: number;
  /** Přibližná velikost (v bajtech, z `FileEntry.size` – bez čtení) souborů spadajících do
   *  `omittedFiles`. POZOR: bajty ≠ znaky u UTF-8 (diakritika/emoji), je to řádová míra
   *  „o kolik kódu jsem přišel", ne bajt-přesný objem promptu. 0 když nic neuříznuto. */
  omittedBytes: number;
  /** Cesty ZDROJOVÝCH souborů (správná přípona, ne minifikát), které by jinak byly AI
   *  kandidáti, ale překročily per-file strop (`AI_PAYLOAD_PER_FILE_MAX_BYTES`) → AI je
   *  nevidělo. Přiznává se v reportu (ne tiché vynechání). NEzahrnuje minifikáty ani
   *  ne-zdrojové soubory – ty nejsou AI kandidáti, byl by to šum. */
  oversizedFiles: string[];
}

/**
 * Strop celkové délky payloadu ve znacích. Jeden dotaz (žádné krájení na desítky
 * částí – to je pozdější fáze). POZOR: strop je ve ZNACÍCH, ne v tokenech – poměr
 * ~3,3 znaku/token je jen hrubá heuristika, u hustého kódu jich může být víc.
 * ~1,65M znaků je tedy zhruba ~500k tokenů (u hustšího kódu i méně) – i s výstupem
 * (max 64–128k) stále pod 1M kontextem všech tří modelů (opus 4.8, sonnet 4.6,
 * glm-5.2). Na velké projekty se tak vejde víc; u extrémně velkých se pořád uřízne
 * a přizná (`truncated`).
 *
 * VĚDOMÝ KOMPROMIS, ne řešení: větší strop = lineárně větší náklad (řádově $2,5
 * vstup/režim na opusu u projektu těsně pod stropem). Tichý už ale NENÍ – brána
 * odhadu ceny (fáze 51) ho před během spočítá a nad prahem vyžádá potvrzení. Dvě
 * další rizika strop neřeší: (1) lost-in-the-middle – obří kontext zhoršuje míření
 * nálezů na konkrétní řádek (obrana proti halucinaci); (2) robustnější cesta pro
 * velké projekty je krájení na části (backlog), ne nafouknutý single-shot. GLOBÁLNÍ,
 * ne per-model (per-model strop je todo 19). Konstanta = kontrakt, ne konfig.
 */
export const AI_PAYLOAD_CHAR_BUDGET = 1_650_000;

/** Strop pro JEDEN soubor v bajtech – jeden obří generovaný soubor by jinak sám
 *  vyžral celý rozpočet. Vybírá se podle `FileEntry.size` (z scanu), bez čtení. */
export const AI_PAYLOAD_PER_FILE_MAX_BYTES = 100_000;

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
 * JEDINÝ zdroj pravdy pro výběr souborů do AI vrstvy. Sdílí ho `collectAiPayload`
 * (single-shot) i `splitAiPayload` (krájení) – aby výběr nedriftoval mezi dvěma
 * cestami. Kandidát = soubor (ne adresář), ne minifikát, se zdrojovou příponou.
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

/** Slepí jeden soubor do payloadu s hlavičkou cesty. SDÍLENÝ formát – `collectAiPayload`
 *  i `splitAiPayload` musí slepovat stejně, jinak by se část poslaná AI lišila tvarem.
 *  Změna formátu = změna kontraktu pro obě cesty (a pro odkazy na řádky v nálezech). */
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

/**
 * Vybere zdrojové soubory a slepí je do payloadu pod stropem. `readFile` je
 * injektované (dostává cestu RELATIVNÍ ke kořeni, stejně jako `FileEntry.path`) –
 * testy předají fake, ostrý běh čte z disku. Výběr: jen soubory se zdrojovou
 * příponou, ne minifikáty, do per-file stropu. Pořadí podle cesty (deterministické).
 *
 * Strop: první soubor se zahrne vždy (i kdyby byl sám nad stropem – ať se VŽDY něco
 * pošle); každý další jen pokud se vejde, jinak `truncated = true` a konec.
 */
export async function collectAiPayload(
  files: readonly FileEntry[],
  readFile: (relPath: string) => Promise<string>,
): Promise<AiPayload> {
  // Výběr (kandidáti + oversized) je sdílený se `splitAiPayload` – jeden zdroj pravdy.
  const { selected, oversizedFiles } = selectAiCandidates(files);

  const includedFiles: PayloadFile[] = [];
  let text = "";
  let truncated = false;

  for (const f of selected) {
    const content = await readFile(f.path);
    const chunk = formatFileChunk(f.path, content);
    if (text.length > 0 && text.length + chunk.length > AI_PAYLOAD_CHAR_BUDGET) {
      truncated = true;
      break;
    }
    text += chunk;
    includedFiles.push({ path: f.path, lineCount: countLines(content) });
  }

  // `includedFiles` je VŽDY prefix `selected` (přidáváme v pořadí, jen `break` při přetečení),
  // takže vynechané = zbytek za prefixem. Velikost z `f.size` (scan), bez čtení uříznutých
  // souborů – to je přesně to, čemu se strop vyhýbá. truncated ⟺ omittedFiles > 0.
  const omitted = selected.slice(includedFiles.length);
  const omittedFiles = omitted.length;
  const omittedBytes = omitted.reduce((sum, f) => sum + f.size, 0);

  return { text, includedFiles, truncated, omittedFiles, omittedBytes, oversizedFiles };
}

/** Jedna část (chunk) pro samostatné AI volání: slepený kód + seznam zahrnutých
 *  souborů s počty řádků (kontrola místa proti halucinaci, jako u `AiPayload`). */
export interface AiChunk {
  text: string;
  includedFiles: PayloadFile[];
}

/**
 * Výsledek krájení: pole částí (každá samostatný AI dotaz) a globálně vynechané
 * oversized soubory. ZÁMĚRNĚ bez `truncated`/`omitted*` (na rozdíl od `AiPayload`) –
 * dělič NIC nezahazuje kvůli celkovému stropu, to je celý smysl krájení; jediné
 * vynechané jsou oversized (nad per-file stropem), stejně jako u single-shotu.
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
 * prošel per-file výběrem, tak patří dovnitř (kopíruje „první se zahrne vždy"
 * z `collectAiPayload`). Reálně s dnešními konstantami nenastane (per-file strop
 * 100 kB << okno), ale `window` je parametr, tak je to ošetřené.
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
