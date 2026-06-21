import { AI_PROVIDERS, type AiModelChoice } from "./aiStatus.js";
import type { ChunkedPayload } from "./aiPayload.js";

/**
 * Hrubý poměr znaků na token pro odhad VSTUPU. Záměrně KONZERVATIVNÍ (spíš
 * nadhodnocuje počet tokenů → spíš nadhodnocuje cenu, takže odhad nepřekvapí
 * směrem nahoru). Reálný poměr se liší podle modelu i jazyka (GLM docs: 1 token
 * ≈ 0,75 angl. slova ≈ 1,5 čín. znaku; pro hustý kód spíš ~4 znaky/token), proto
 * je každé jedno číslo nutně vedle – odhad se prezentuje jako ROZSAH, ne přesná
 * cena. Tokenizer knihovnu vědomě NEPŘIDÁVÁME (neřeší dominantní nejistotu =
 * výstup, a pro GLM stejně chybí encoding). Stejná heuristika je popsaná
 * v `aiPayload.ts`.
 */
export const CHARS_PER_TOKEN = 3.3;

/**
 * Konzervativní SPODNÍ odhad výstupu na jeden režim. Nikdy ne nula: i „levný"
 * běh spotřebuje thinking (účtuje se jako výstup) + malý JSON s nálezy. 2k tokenů
 * je hrubá dolní mez (ne příslib) – horní mez je per-model strop `maxTokens`.
 */
export const OUTPUT_MIN_TOKENS_PER_MODE = 2_000;

/**
 * REALISTICKÝ (střední) odhad výstupu na jeden režim – slouží JEN pro práh potvrzení ceny
 * (`AI_COST_CONFIRM_THRESHOLD_USD` v cli.ts), ne pro zobrazený rozsah. Worst-case = strop modelu
 * (`maxTokens`) bránu rozbíjel: glm má strop 131072 tok., což i s NULOVÝM vstupem přeleze práh
 * ($0.58 jen z výstupu) → glm se ptal vždycky a brána ztratila signál. 16k = „plná reálná odpověď"
 * (thinking + JSON nálezů), shodou okolností strop opus/sonnet. Jedna GLOBÁLNÍ hodnota (ne
 * per-model): JSON nálezů je napříč modely podobný a o thinkingu nemáme data, takže per-model by
 * byla nadbytečná složitost.
 *
 * POZOR – undershoot: glm jede `reasoningEffort:high`, thinking se účtuje jako výstup a může 16k
 * překročit (reálný běh klidně ~60k tok. ≈ $0.80). Brána se pak nezeptá, ač účet přeleze práh.
 * VĚDOMÝ kompromis: worst-case `costMaxUsd` zůstává VYTIŠTĚNÝ ve výpisu (uživatel ho vidí), jen
 * ho neotravujeme dotazem. Měníme, co spouští dotaz, ne co se uživateli ukáže.
 */
export const OUTPUT_TYPICAL_TOKENS_PER_MODE = 16_000;

/**
 * Odhad ceny JEDNOHO AI běhu před voláním API. Vše v tokenech jsou CELKY napříč
 * vyžádanými režimy (`modeCount`), protože každý režim je samostatné API volání
 * a posílá CELÝ payload znovu → vstup se násobí počtem režimů, ne jen výstup.
 */
export interface AiCostEstimate {
  /** Odhadnuté vstupní tokeny na JEDEN režim CELKEM (součet všech částí → tokeny).
   *  Krájení vstup nezdvojuje – součet částí = celý projekt jednou, jen rozdělený do
   *  `chunkCount` volání. Proto vstup škáluje s `modeCount`, NE s `chunkCount`. */
  inputTokensPerMode: number;
  /** Počet vyžádaných režimů (kolikrát se celý projekt pošle). */
  modeCount: number;
  /** Na kolik částí se projekt rozkrájel – každá je samostatné API volání, takže VÝSTUP
   *  (ne vstup) škáluje navíc tímto číslem. */
  chunkCount: number;
  /** Spodní/horní mez výstupních tokenů CELKEM (součet přes režimy). */
  outputMinTokens: number;
  outputMaxTokens: number;
  /** Dolní a horní mez ceny v USD (vstup je u obou stejný, liší se jen výstup). */
  costMinUsd: number;
  costMaxUsd: number;
  /**
   * REALISTICKÝ odhad ceny (vstup + `OUTPUT_TYPICAL_TOKENS_PER_MODE` na režim). Leží mezi
   * `costMinUsd` a `costMaxUsd`. Tohle – ne worst-case – řídí práh potvrzení ceny v cli.ts.
   */
  costTypicalUsd: number;
}

/**
 * Spočítá přibližný rozsah ceny pro `modeCount` vyžádaných AI režimů na daném modelu.
 * Bere KRÁJENÝ payload: vstup = součet délek všech částí (celý projekt jednou per režim,
 * krájení vstup nezdvojuje), výstup škáluje navíc počtem částí (`chunkCount`), protože
 * každá část je samostatné API volání a může vyčerpat výstupní strop. Čistá funkce
 * (žádné I/O) – testovatelná izolovaně. Ceník i výstupní strop z `AI_PROVIDERS`.
 * `modeCount <= 0` (teoreticky) → nulový odhad. Prázdné `chunks` → vstup 0 tokenů
 * i výstup 0 (×0 částí), bez pádu.
 */
export function estimateAiCost(chunked: ChunkedPayload, model: AiModelChoice, modeCount: number): AiCostEstimate {
  const provider = AI_PROVIDERS[model];
  const modes = Math.max(0, modeCount);
  const chunkCount = chunked.chunks.length;
  const totalChars = chunked.chunks.reduce((sum, c) => sum + c.text.length, 0);

  const inputTokensPerMode = Math.ceil(totalChars / CHARS_PER_TOKEN);
  const totalInputTokens = inputTokensPerMode * modes;
  // Výstup × modes × chunkCount: každý režim pošle KAŽDOU část zvlášť → tolik výstupů.
  const outputMinTokens = OUTPUT_MIN_TOKENS_PER_MODE * modes * chunkCount;
  const outputMaxTokens = provider.maxTokens * modes * chunkCount;
  const outputTypicalTokens = OUTPUT_TYPICAL_TOKENS_PER_MODE * modes * chunkCount;

  const inputCostUsd = (totalInputTokens / 1_000_000) * provider.prices.input;
  const costMinUsd = inputCostUsd + (outputMinTokens / 1_000_000) * provider.prices.output;
  const costMaxUsd = inputCostUsd + (outputMaxTokens / 1_000_000) * provider.prices.output;
  const costTypicalUsd = inputCostUsd + (outputTypicalTokens / 1_000_000) * provider.prices.output;

  return { inputTokensPerMode, modeCount: modes, chunkCount, outputMinTokens, outputMaxTokens, costMinUsd, costMaxUsd, costTypicalUsd };
}

/** Cenu naformátuje na 2 desetinná místa; nepatrné nenulové částky nezamlčí jako $0.00. */
function fmtUsd(usd: number): string {
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

/**
 * Lidský víceřádkový odhad (čeština) pro výpis na stderr před AI během. EXPLICITNĚ
 * označený jako přibližný odhad, ne fakturace, a podaný jako rozsah „řádově X až
 * nejvýš Y" – horní mez je worst-case (model zapíše až po strop), proto „nejvýš".
 */
export function formatCostEstimate(estimate: AiCostEstimate, model: AiModelChoice): string {
  const chunkNote = estimate.chunkCount === 1 ? "1 část" : `${estimate.chunkCount} částí`;
  return [
    `Odhad ceny AI (model ${model}, ${estimate.modeCount}× režim, projekt rozdělen na ${chunkNote}) – PŘIBLIŽNÝ odhad podle heuristiky, NE fakturace:`,
    `  vstup:  ~${estimate.inputTokensPerMode} tokenů/režim (celý projekt; posílá se ${estimate.modeCount}×)`,
    `  výstup: předem neznámý, ${estimate.outputMinTokens}–${estimate.outputMaxTokens} tokenů celkem (každá část = vlastní volání; horní = strop modelu × části)`,
    `  celkem: řádově ${fmtUsd(estimate.costMinUsd)} až nejvýš ${fmtUsd(estimate.costMaxUsd)}`,
    `  realistický odhad: ~${fmtUsd(estimate.costTypicalUsd)} (na tohle se dívá práh potvrzení; horní mez je worst-case)`,
  ].join("\n");
}
