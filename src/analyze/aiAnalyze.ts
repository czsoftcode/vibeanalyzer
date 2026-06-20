import Anthropic from "@anthropic-ai/sdk";
import type { AiModelChoice, AiUsage } from "./aiStatus.js";
import { AI_MODEL_IDS } from "./aiResult.js";

/**
 * Pojistka proti ÚPLNÉMU zaseknutí v ms (TS SDK bere timeout v MILISEKUNDÁCH).
 * Schválně PRAKTICKY NEOMEZENÝ (30 min): u velkého projektu analýza legitimně trvá
 * minuty a pevný útes by utnul přesně ty drahé běhy → zaplatíš a nic nedostaneš
 * (server účtuje, i když klient odpadne). Proto STREAMING (viz realAiAnalyze):
 * spojení zůstává živé průběžnými tokeny, žádná nečinnost k utnutí. Tahle hodnota
 * je jen krajní pojistka, kdyby spojení úplně umřelo a nic neteklo.
 */
export const AI_ANALYZE_TIMEOUT_MS = 1_800_000;

/**
 * Žádný retry. Měření ukázalo past: SDK retry-uje i timeouty, takže `maxRetries: 2`
 * + krátký timeout = SLEPÉ NÁSOBENÍ čekání i CENY – server naúčtuje každý pokus,
 * klient výsledek pokaždé zahodí (sonnet první běh ~$1 za nic). U dlouhého drahého
 * callu chceme jeden pokus a čisté selhání, ne opakované placení za zahozený výsledek.
 */
export const AI_ANALYZE_MAX_RETRIES = 0;

/**
 * Strop výstupních tokenů. POZOR: adaptive thinking se počítá DO výstupu – měření
 * ukázalo, že sonnet „promyslel" ~7,5k tokenů a na 8000 stropu mu nezbylo místo na
 * samotný JSON → uříznutá odpověď. Proto velká rezerva (16k). Reziduální uříznutí
 * navíc řeší runAiAnalysis čistým skipem (stop_reason=max_tokens), ne pádem.
 */
export const AI_ANALYZE_MAX_TOKENS = 16000;

/**
 * Reálný analytický dotaz. Resolve = API odpovědělo strukturovaným JSONem (rawText)
 * + skutečná `usage`; reject = chyba (zatřídí ji `classifyAiError` u volajícího).
 *
 * STREAMING (ne create): u dlouhé analýzy drží spojení živé průběžnými tokeny, takže
 * ho infrastruktura neutne kvůli nečinnosti a není pevný útes na X minutách – jediná
 * obrana proti „zaplať a nic nedostaneš" na velkém projektu. `finalMessage()` vrátí
 * až hotovou zprávu (nám stačí finální JSON, dílčí eventy nezpracováváme).
 *
 * `maxRetries: 0` (viz AI_ANALYZE_MAX_RETRIES). `output_config.format` se schématem
 * garantuje parsovatelný tvar. `schema` injektuje VOLAJÍCÍ podle režimu (non-goal vs
 * code) – musí sedět na `system`/prompt, jinak model vrátí tvar, který parser odmítne.
 * Chyby tady NEodchytáváme – necháme je probublat.
 */
export const realAiAnalyze = async (
  apiKey: string,
  model: AiModelChoice,
  system: string,
  userPrompt: string,
  schema: { [key: string]: unknown },
): Promise<{ rawText: string; usage: AiUsage; stopReason: string | null }> => {
  const client = new Anthropic({ apiKey, maxRetries: AI_ANALYZE_MAX_RETRIES, timeout: AI_ANALYZE_TIMEOUT_MS });
  const stream = client.messages.stream({
    model: AI_MODEL_IDS[model],
    max_tokens: AI_ANALYZE_MAX_TOKENS,
    thinking: { type: "adaptive" },
    output_config: { format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: userPrompt }],
  });
  const res = await stream.finalMessage();

  // Strukturovaný výstup přijde jako textový blok (JSON). Thinking bloky ignorujeme.
  const textBlock = res.content.find((b) => b.type === "text");
  const rawText = textBlock && textBlock.type === "text" ? textBlock.text : "";
  const usage: AiUsage = {
    inputTokens: res.usage.input_tokens ?? 0,
    outputTokens: res.usage.output_tokens,
  };
  // stop_reason vrátíme výš: "max_tokens" = výstup uříznut (thinking sežral rozpočet),
  // což je provozní stav k čistému přeskočení, ne k pádu na rozbitém JSON.
  return { rawText, usage, stopReason: res.stop_reason };
};
