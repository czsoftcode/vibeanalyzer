import Anthropic from "@anthropic-ai/sdk";
import { AI_PROVIDERS, type AiModelChoice, type AiUsage } from "./aiStatus.js";

/**
 * Options pro Anthropic klienta podle zvoleného modelu. Vytaženo zvlášť, aby šel
 * `baseURL` výběr unit-testovat bez sítě/SDK mocku. Pro glm se nastaví Z.ai endpoint
 * (Anthropic-kompatibilní), pro opus/sonnet zůstane `baseURL` undefined → SDK použije
 * default Anthropic endpoint. `maxRetries`/`timeout` jsou společné (viz konstanty výš).
 */
export function buildAnalyzeClientOptions(apiKey: string, model: AiModelChoice) {
  return {
    apiKey,
    baseURL: AI_PROVIDERS[model].baseURL,
    maxRetries: AI_ANALYZE_MAX_RETRIES,
    timeout: AI_ANALYZE_TIMEOUT_MS,
  };
}

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
 *
 * Tvar dotazu (max_tokens, thinking, příp. reasoning_effort) je PER-MODEL z `AI_PROVIDERS`
 * – ne plošná konstanta. glm potřebuje vyšší strop + explicitní enabled thinking s nízkým
 * reasoning_effort (Z.ai rozšíření), jinak default effort=max sežere strop a výstup se uřízne.
 */
export const realAiAnalyze = async (
  apiKey: string,
  model: AiModelChoice,
  system: string,
  userPrompt: string,
  schema: { [key: string]: unknown },
): Promise<{ rawText: string; usage: AiUsage; stopReason: string | null }> => {
  const client = new Anthropic(buildAnalyzeClientOptions(apiKey, model));
  const provider = AI_PROVIDERS[model];

  // Standardní pole projdou typovou kontrolou SDK. `thinking` castíme cíleně: provider
  // typ povoluje i Z.ai `enabled` bez budget_tokens, který Anthropic SDK typ u `enabled`
  // vyžaduje – to je ale Anthropic-only kontrakt (opus/sonnet stejně jedou `adaptive`).
  const base: Anthropic.MessageStreamParams = {
    model: provider.modelId,
    max_tokens: provider.maxTokens,
    thinking: provider.thinking as Anthropic.Messages.ThinkingConfigParam,
    output_config: { format: { type: "json_schema", schema } },
    system,
    messages: [{ role: "user", content: userPrompt }],
  };
  // reasoning_effort je rozšíření Z.ai (jen glm) – Anthropic SDK typ ho NEzná, proto ho
  // přidáváme cíleně jen tady (ne castem celého requestu na any). Bez effortu (opus/sonnet)
  // posíláme `base` beze změny, ať Anthropic nedostane neznámé pole.
  const params = provider.reasoningEffort
    ? { ...base, reasoning_effort: provider.reasoningEffort }
    : base;

  const stream = client.messages.stream(params);
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
