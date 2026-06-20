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
 * ~800k znaků je tedy zhruba ~240k tokenů (klidně i 250–280k) – stále hluboko pod
 * 1M kontextem modelu. Na běžných projektech se vejde, u velkých se uřízne a přizná.
 *
 * VĚDOMÝ MEZIKROK, ne řešení: větší strop = větší TICHÝ náklad. Odhad ceny PŘED
 * během zatím neexistuje (Fáze 5c / todo 7), takže cenu uvidíš až po doběhu (řádově
 * sonnet ~$0,7 / opus ~$1,2 za jeden režim na projektu těsně pod stropem). Skutečné
 * řešení velkých projektů je krájení na části (backlog). Konstanta = kontrakt, ne konfig.
 */
export const AI_PAYLOAD_CHAR_BUDGET = 800_000;

/** Strop pro JEDEN soubor v bajtech – jeden obří generovaný soubor by jinak sám
 *  vyžral celý rozpočet. Vybírá se podle `FileEntry.size` (z scanu), bez čtení. */
export const AI_PAYLOAD_PER_FILE_MAX_BYTES = 100_000;

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
  // Nejdřív AI kandidáti (zdrojová přípona, ne minifikát, soubor) – z nich pak per-file
  // strop vytřídí ty obří. Ty se NEzahodí potichu: vypíšou se do `oversizedFiles` a report
  // je přizná. Minifikáty/ne-zdrojové sem schválně nepatří (nejsou kandidáti = nejsou nález).
  const candidates = files
    .filter((f) => f.type === "file" && !f.minified && SOURCE_EXTENSIONS.includes(f.ext))
    .sort((a, b) => a.path.localeCompare(b.path));

  const selected = candidates.filter((f) => f.size <= AI_PAYLOAD_PER_FILE_MAX_BYTES);
  const oversizedFiles = candidates.filter((f) => f.size > AI_PAYLOAD_PER_FILE_MAX_BYTES).map((f) => f.path);

  const includedFiles: PayloadFile[] = [];
  let text = "";
  let truncated = false;

  for (const f of selected) {
    const content = await readFile(f.path);
    const chunk = `// ==== ${f.path} ====\n${content}\n`;
    if (text.length > 0 && text.length + chunk.length > AI_PAYLOAD_CHAR_BUDGET) {
      truncated = true;
      break;
    }
    text += chunk;
    includedFiles.push({ path: f.path, lineCount: countLines(content) });
  }

  return { text, includedFiles, truncated, oversizedFiles };
}
