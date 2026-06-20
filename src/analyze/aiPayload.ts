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
}

/**
 * Strop celkové délky payloadu ve znacích. Jeden dotaz (žádné krájení na desítky
 * částí – to je pozdější fáze). ~200k znaků je hrubě ~50k tokenů; na malých
 * projektech se vejde, u velkých se uřízne a přizná. Konstanta = kontrakt, ne konfig.
 */
export const AI_PAYLOAD_CHAR_BUDGET = 200_000;

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
  const selected = files
    .filter(
      (f) =>
        f.type === "file" &&
        !f.minified &&
        SOURCE_EXTENSIONS.includes(f.ext) &&
        f.size <= AI_PAYLOAD_PER_FILE_MAX_BYTES,
    )
    .sort((a, b) => a.path.localeCompare(b.path));

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

  return { text, includedFiles, truncated };
}
