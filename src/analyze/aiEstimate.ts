import { AI_PROVIDERS, type AiModelChoice } from "./aiStatus.js";
import type { AiPayload } from "./aiPayload.js";

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
 * Odhad ceny JEDNOHO AI běhu před voláním API. Vše v tokenech jsou CELKY napříč
 * vyžádanými režimy (`modeCount`), protože každý režim je samostatné API volání
 * a posílá CELÝ payload znovu → vstup se násobí počtem režimů, ne jen výstup.
 */
export interface AiCostEstimate {
  /** Odhadnuté vstupní tokeny na JEDEN požadavek (payload → tokeny). */
  inputTokensPerMode: number;
  /** Počet vyžádaných režimů (kolikrát se payload pošle). */
  modeCount: number;
  /** Spodní/horní mez výstupních tokenů CELKEM (součet přes režimy). */
  outputMinTokens: number;
  outputMaxTokens: number;
  /** Dolní a horní mez ceny v USD (vstup je u obou stejný, liší se jen výstup). */
  costMinUsd: number;
  costMaxUsd: number;
}

/**
 * Spočítá přibližný rozsah ceny pro `modeCount` vyžádaných AI režimů na daném
 * modelu. Čistá funkce (žádné I/O ani stdin) – testovatelná izolovaně. Ceník
 * i výstupní strop bere z `AI_PROVIDERS` (žádný duplikát). `modeCount <= 0`
 * (teoreticky) → nulový odhad, bez pádu. Prázdný payload → vstup 0 tokenů
 * (dělíme délku konstantou, nikdy nulou), výstup stále počítá se stropem.
 */
export function estimateAiCost(payload: AiPayload, model: AiModelChoice, modeCount: number): AiCostEstimate {
  const provider = AI_PROVIDERS[model];
  const modes = Math.max(0, modeCount);

  const inputTokensPerMode = Math.ceil(payload.text.length / CHARS_PER_TOKEN);
  const totalInputTokens = inputTokensPerMode * modes;
  const outputMinTokens = OUTPUT_MIN_TOKENS_PER_MODE * modes;
  const outputMaxTokens = provider.maxTokens * modes;

  const inputCostUsd = (totalInputTokens / 1_000_000) * provider.prices.input;
  const costMinUsd = inputCostUsd + (outputMinTokens / 1_000_000) * provider.prices.output;
  const costMaxUsd = inputCostUsd + (outputMaxTokens / 1_000_000) * provider.prices.output;

  return { inputTokensPerMode, modeCount: modes, outputMinTokens, outputMaxTokens, costMinUsd, costMaxUsd };
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
  return [
    `Odhad ceny AI (model ${model}, ${estimate.modeCount}× režim) – PŘIBLIŽNÝ odhad podle heuristiky, NE fakturace:`,
    `  vstup:  ~${estimate.inputTokensPerMode} tokenů/režim (posílá se ${estimate.modeCount}×)`,
    `  výstup: předem neznámý, ${estimate.outputMinTokens}–${estimate.outputMaxTokens} tokenů celkem (horní = strop modelu)`,
    `  celkem: řádově ${fmtUsd(estimate.costMinUsd)} až nejvýš ${fmtUsd(estimate.costMaxUsd)}`,
  ].join("\n");
}
