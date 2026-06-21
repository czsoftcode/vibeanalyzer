import type { AiModelChoice, AiStatus, AiUsage } from "./aiStatus.js";
import type { AiChunk } from "./aiPayload.js";
import type { Finding } from "../findings.js";

/**
 * Výsledek krájeného AI běhu: JEDEN sloučený stav přes všechny části + metadata
 * o krájení. Metadata schválně NEjsou v `AiStatus` – ten sdílí i nekrájené cesty
 * (`--ai-check`, pouhá detekce klíče), kam počty částí nepatří.
 */
export interface ChunkedRunResult {
  /** Sloučený stav: `analyzed` (posbírané nálezy + sečtená usage/cena), nebo `skipped`
   *  (žádná část neprošla / prázdný vstup) se souhrnným důvodem. */
  status: AiStatus;
  /** Počet částí, přes které se běželo (0 pro prázdný vstup). */
  chunkTotal: number;
  /** Kolik částí NEvrátilo `analyzed` (přeskočeno provozní chybou apod.). */
  chunkFailed: number;
  /** Důvody přeskočených částí (`skipped.reason`), pro pozdější přiznání v reportu. */
  failureReasons: string[];
}

/** Souhrnný důvod pro stav `skipped`, když žádná část neprošla. Jeden společný důvod
 *  (typicky chybějící klíč → všechny části stejně) se nechá tak, jak je; různé důvody
 *  se spojí, ať report ukáže PRAVÝ důvod, ne jen „přeskočeno". */
function summarizeFailures(reasons: string[], total: number): string {
  if (reasons.length === 0) return `žádná z ${total} částí nevrátila výsledek`;
  const unique = [...new Set(reasons)];
  if (unique.length === 1) return unique[0]!;
  return `všechny části přeskočeny: ${unique.join("; ")}`;
}

/**
 * Spustí JEDEN AI režim přes všechny části a sloučí výsledky do jednoho.
 * `runOne` (spuštění režimu na jedné části) injektuje volající (cli předá obal nad
 * `run*Analysis`) – orchestrátor sám nevolá API ani `run*Analysis`, je čistý a
 * generický přes všechny tři režimy.
 *
 * Běží SEKVENČNĚ (deterministické pořadí nálezů = pořadí částí; žádný nával na API).
 * Stateless – části na sobě nezávisí; paralelizace je možná později, teď se nedělá.
 *
 * Slučování ÚSPĚŠNÝCH (`analyzed`) částí: nálezy se spojí v pořadí částí, tokeny
 * (input+output) i cena se sečtou, model se vezme z první úspěšné (všechny části běží
 * na témž modelu). PROVOZNĚ přeskočená část (`skipped` – 529/timeout/max_tokens) se
 * NEzahodí: počítá se do `chunkFailed` + `failureReasons` a běh pokračuje dál.
 *
 * Stav výsledku: ≥1 část `analyzed` → `analyzed` (posbírané). Žádná → `skipped` se
 * souhrnným důvodem. Prázdný vstup (0 částí) → `skipped` jako u `run*Analysis`.
 *
 * POZOR – cena: `skipped` část nenese usage/cenu strukturovaně (jen v textu reason),
 * takže cena provozně přeskočené (např. max_tokens) části se do sloučené `costUsd`
 * NEzapočítá → mírné PODHODNOCENÍ. Vědomě odloženo (viz mini todo). PROGRAMOVÁ chyba
 * z `runOne` (throw – `classify` ji nezná) se NEMASKUJE: probublá se stackem.
 */
export async function runChunkedMode(
  chunks: readonly AiChunk[],
  runOne: (chunk: AiChunk, index: number) => Promise<AiStatus>,
): Promise<ChunkedRunResult> {
  if (chunks.length === 0) {
    return {
      status: { kind: "skipped", reason: "žádné zdrojové soubory k analýze" },
      chunkTotal: 0,
      chunkFailed: 0,
      failureReasons: [],
    };
  }

  const findings: Finding[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let costUsd = 0;
  let model: AiModelChoice | null = null;
  let analyzedCount = 0;
  const failureReasons: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    // runOne hází jen u PROGRAMOVÉ chyby (classify ji nezná) → necháme probublat se
    // stackem (await bez try/catch), ať se programová chyba nemaskuje jako přeskočení.
    const status = await runOne(chunks[i]!, i);
    if (status.kind === "analyzed") {
      analyzedCount++;
      if (model === null) model = status.model;
      findings.push(...status.findings);
      inputTokens += status.usage.inputTokens;
      outputTokens += status.usage.outputTokens;
      costUsd += status.costUsd;
    } else if (status.kind === "skipped") {
      failureReasons.push(status.reason);
    }
    // `ready`/`verified` v analytickém běhu nenastávají; kdyby přece, nezapočítají se
    // do nálezů ani důvodů (nemají reason) – jen sníží poměr analyzed/total.
  }

  const chunkTotal = chunks.length;
  const chunkFailed = chunkTotal - analyzedCount;

  if (analyzedCount > 0 && model !== null) {
    const usage: AiUsage = { inputTokens, outputTokens };
    return { status: { kind: "analyzed", model, findings, usage, costUsd }, chunkTotal, chunkFailed, failureReasons };
  }

  return {
    status: { kind: "skipped", reason: summarizeFailures(failureReasons, chunkTotal) },
    chunkTotal,
    chunkFailed,
    failureReasons,
  };
}
