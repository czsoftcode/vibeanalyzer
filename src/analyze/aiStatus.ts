import type { Finding } from "../findings.js";

/** Který analytický model uživatel zvolil (`--ai-model`). Sdílený literál (kontrakt
 *  args ↔ cli ↔ analýza ↔ provider tabulka). Popis providera je v `AI_PROVIDERS`. */
export type AiModelChoice = "opus" | "sonnet" | "glm";

/**
 * Popis providera modelu: jak ho volat (API id, endpoint, klíč) a kolik stojí.
 * JEDEN zdroj pravdy pro celou AI vrstvu – aby čtyři dřív oddělené tabulky klíčované
 * `AiModelChoice` (id / ceny / keyEnv / baseURL) nedriftovaly. `baseURL` undefined =
 * default Anthropic endpoint; jiný (Z.ai) = Anthropic-kompatibilní endpoint volaný
 * stejným SDK. `keyEnv` = jméno env proměnné s klíčem daného providera (ne hodnota).
 */
export interface AiProvider {
  modelId: string;
  /** Nepovinné: jiný než default Anthropic endpoint (Z.ai je Anthropic-kompatibilní). */
  baseURL?: string;
  keyEnv: string;
  /** Ceny v USD za milion tokenů (vstup/výstup). Natvrdo – non-goal zakazuje konfig. */
  prices: { input: number; output: number };
  /**
   * Strop výstupních tokenů (per-model, protože poskytovatelé se liší). POZOR: thinking
   * se počítá DO výstupu. U Anthropic (opus/sonnet) měření ukázalo, že sonnet „promyslel"
   * ~7,5k a na 8000 stropu nezbylo místo na JSON → uříznuto; proto rezerva 16k. glm jede
   * na vlastní default 64k (Z.ai default je 65536; náš dřívější plošný 16k ho STAHOVAL
   * pod jeho default a uřezával výstup). Reziduální uříznutí řeší runAiAnalysis čistým
   * skipem (stop_reason=max_tokens), ne pádem.
   */
  maxTokens: number;
  /**
   * Tvar pole `thinking` pro SDK volání. Anthropic (opus/sonnet) umí `adaptive` (model si
   * sám řídí rozsah). Z.ai `adaptive` NEZNÁ (zná jen enabled/disabled) a tiše ho ignoruje
   * → spadne na default enabled + reasoning_effort=max → sežere strop. Proto glm dostává
   * explicitní `enabled`. POZN.: Z.ai `enabled` NEpoužívá budget_tokens (řídí se přes
   * `reasoningEffort`), proto vlastní volný tvar – Anthropic SDK typ u `enabled` budget
   * vyžaduje, ale to je Anthropic-only kontrakt, sem nepatří.
   */
  thinking: { type: "adaptive" } | { type: "enabled" };
  /**
   * Rozšíření Z.ai (NE standardní Anthropic parametr). Síla uvažování pro GLM-5.2+; default
   * poskytovatele je „max", což je přesně příčina uřezávání → posíláme nízkou hodnotu.
   * Nastaveno JEN pro glm; opus/sonnet ho nemají (Anthropic by neznámé pole mohl odmítnout).
   * Povolené hodnoty Z.ai: max|xhigh|high|medium|low|minimal|none.
   */
  reasoningEffort?: "max" | "xhigh" | "high" | "medium" | "low" | "minimal" | "none";
}

/**
 * Provider per model. opus/sonnet jedou na Anthropic (default endpoint, ANTHROPIC_API_KEY).
 * glm (GLM-5.2 od Z.ai) jede na Anthropic-kompatibilní endpoint Z.ai s vlastním klíčem
 * ZAI_API_KEY – výrazně levnější. Ceny glm: zdroj docs.z.ai/guides/overview/pricing
 * (cache rate tu nemodelujeme – počítáme flat input).
 */
export const AI_PROVIDERS: Record<AiModelChoice, AiProvider> = {
  opus: {
    modelId: "claude-opus-4-8",
    keyEnv: "ANTHROPIC_API_KEY",
    prices: { input: 5, output: 25 },
    maxTokens: 16000,
    thinking: { type: "adaptive" },
  },
  sonnet: {
    modelId: "claude-sonnet-4-6",
    keyEnv: "ANTHROPIC_API_KEY",
    prices: { input: 3, output: 15 },
    maxTokens: 16000,
    thinking: { type: "adaptive" },
  },
  glm: {
    modelId: "glm-5.2",
    baseURL: "https://api.z.ai/api/anthropic",
    keyEnv: "ZAI_API_KEY",
    prices: { input: 1.4, output: 4.4 },
    maxTokens: 65536,
    thinking: { type: "enabled" },
    reasoningEffort: "low",
  },
};

/** Spotřeba tokenů z odpovědi API (z `usage`). `inputTokens` může být null (fallback),
 *  proto se při čtení coalescuje na 0 – sem ukládáme už číslo. */
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Stav AI vrstvy. Rozlišitelné stavy (diskriminovaná unie jako u ostatních vrstev –
 * tsc, audit, …), aby ze strojového výstupu šlo poznat, co se stalo:
 *   - `skipped`  – AI neproběhla (chybí klíč, síť/timeout, odmítnutý klíč, žádné
 *                  non-goaly) + důvod.
 *   - `ready`    – klíč nalezen, ale reálný dotaz NEPROBĚHL (default běh bez
 *                  `--ai-check`/`--ai`). NE falešné „hotovo".
 *   - `verified` – levný testovací dotaz na API proběhl (jen s `--ai-check`).
 *                  Schválně ne dřív: `ready` ≠ „ověřeno".
 *   - `analyzed` – reálná analýza non-goalů proběhla (jen s `--ai`): nese nálezy,
 *                  skutečnou spotřebu tokenů a spočítanou cenu.
 */
export type AiStatus =
  | { kind: "skipped"; reason: string }
  | { kind: "ready" }
  | { kind: "verified" }
  | { kind: "analyzed"; model: AiModelChoice; findings: Finding[]; usage: AiUsage; costUsd: number };

/**
 * Souhrn AI vrstvy v reportu. Každý režim běží na vlastní přepínač a je NEZÁVISLÝ –
 * vlastní `AiStatus` (analyzed s nálezy/usage/cenou, nebo skipped s důvodem):
 *   - `nonGoal` – analýza porušení non-goalů (`--ai-non-goal`).
 *   - `code`    – analýza kvality/rizik kódu (`--ai-code`).
 *   - `logic`   – analýza funkčnosti kódu jako celku vůči záměru (`--ai-logic`).
 * Bez běhu daného přepínače je příslušné pole ve stavu `ready`/`skipped`
 * (NE falešné „analyzováno").
 *
 * `oversizedFiles` je payload-metadata (cesty zdrojových souborů vynechaných z AI kvůli
 * per-file stropu) – vědomě jede tudy, protože `AiReport` je jediný kanál AI dat do
 * reportu; nepovinné, plní se jen když se reálně stavěl payload (běžel analytický režim).
 *
 * `truncation` je rovněž payload-metadata (sdílená VŠEMI režimy): payload nasbíral kód až
 * na strop `AI_PAYLOAD_CHAR_BUDGET` a zbytek uřízl → AI posuzovala NEÚPLNÝ projekt. Report
 * to musí přiznat stejně jako `oversizedFiles` (jinak nález vypadá jako kompletní posouzení).
 * Přítomnost pole = uříznuto (jinak chybí). Nese KOLIK (soubory/bajty), ne jen ŽE.
 * Nepovinné a plní se JEN když se reálně stavěl payload; větve bez payloadu (`--ai-check`,
 * pouhá detekce klíče) ho vynechají.
 */
export interface AiReport {
  nonGoal: AiStatus;
  code: AiStatus;
  logic: AiStatus;
  oversizedFiles?: string[];
  truncation?: TruncationInfo;
}

/**
 * Kolik kódu AI NEvidělo kvůli uříznutí na celkovém stropu (`AI_PAYLOAD_CHAR_BUDGET`).
 * `includedFiles` + `omittedFiles` = celkový počet zdrojových kandidátů (bez `oversizedFiles`,
 * to je oddělená kategorie). `omittedBytes` je z `FileEntry.size` (bajty, ne znaky – řádová
 * míra, viz `AiPayload.omittedBytes`).
 */
export interface TruncationInfo {
  includedFiles: number;
  omittedFiles: number;
  omittedBytes: number;
}

/** Lidsky čitelná velikost v bajtech (B/kB/MB). Sjednocené formátování `omittedBytes`
 *  pro report i stderr (ať se znění nerozejde). Bajty, ne znaky (UTF-8 – viz `TruncationInfo`). */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${bytes} B`;
}

/**
 * JEDNA věta o uříznutí, sdílená reportem (.md poznámka) i stderr hláškou – aby se znění
 * nerozcházelo (cross-module kontrakt: stejný text, jeden zdroj). „~" u velikosti je
 * záměrné: bajty jsou jen řádová míra, ne přesný objem promptu.
 */
export function describeTruncation(info: TruncationInfo): string {
  const total = info.includedFiles + info.omittedFiles;
  return (
    `AI viděla ${info.includedFiles} z ${total} zdrojových souborů; ` +
    `~${formatBytes(info.omittedBytes)} kódu (${info.omittedFiles} souborů) se kvůli celkové velikosti ` +
    `do dotazu nevešlo – posouzení je neúplné.`
  );
}

/** Jméno env proměnné s klíčem k Anthropic API. Default provider (opus/sonnet) i
 *  Anthropic-only cesta `--ai-check` (ping). Sdílený literál (kontrakt). */
export const AI_KEY_ENV = "ANTHROPIC_API_KEY";

/** Důvod přeskočení, když chybí klíč dané env proměnné. Dynamický (per provider) –
 *  s glm už není jediný klíč. */
export function missingKeyReason(keyEnv: string): string {
  return `chybí ${keyEnv}`;
}

/** Důvod přeskočení, když chybí Anthropic klíč. Sdílený s `--ai-check` cestou (cli)
 *  i testy – musí zůstat PŘESNÁ konstanta (cli porovnává reason === této hodnotě). */
export const AI_MISSING_KEY_REASON = missingKeyReason(AI_KEY_ENV);

/**
 * Nízkoúrovňová detekce existence KONKRÉTNÍHO klíče (bez vědomí o modelu/providerech).
 * Klíč chybějící, prázdný nebo jen z whitespace → `skipped` s plain důvodem (bez
 * cross-provider nápovědy); jinak `ready`. Používá ji ping cesta (`--ai-check`), kde
 * je provider vždy Anthropic a nápověda na glm by byla matoucí.
 *
 * POZOR: nikdy nevrací hodnotu klíče – jen příznak existence. Klíč je tajemství.
 */
export function detectKeyStatus(env: Record<string, string | undefined>, keyEnv: string): AiStatus {
  const raw = env[keyEnv];
  if (raw === undefined || raw.trim() === "") {
    return { kind: "skipped", reason: missingKeyReason(keyEnv) };
  }
  return { kind: "ready" };
}

/**
 * Najde provider JINÉHO modelu, jehož klíč JE v prostředí nastaven (a liší se od
 * `selectedKeyEnv`). Pro nápovědu „máš klíč jiného providera – přepni model". Vrací
 * první takový (opus/sonnet sdílí ANTHROPIC, takže pro chybějící ZAI navrhne opus).
 */
function findAltProvider(
  env: Record<string, string | undefined>,
  selectedKeyEnv: string,
): { model: AiModelChoice; keyEnv: string } | null {
  for (const model of Object.keys(AI_PROVIDERS) as AiModelChoice[]) {
    const keyEnv = AI_PROVIDERS[model].keyEnv;
    if (keyEnv === selectedKeyEnv) continue;
    const raw = env[keyEnv];
    if (raw !== undefined && raw.trim() !== "") {
      return { model, keyEnv };
    }
  }
  return null;
}

/**
 * Brána AI vrstvy pro ZVOLENÝ model (model-aware): hlídá klíč providera daného modelu
 * (`AI_PROVIDERS[model].keyEnv`), default `opus` (= Anthropic, zpětně kompatibilní se
 * starým chováním bez argumentu). Když klíč chybí, ale je nastaven klíč JINÉHO providera,
 * důvod přeskočení to napoví (… přidej --ai-model=X?). Default model `opus` zachovává
 * původní kontrakt: `detectAiStatus({})` → „chybí ANTHROPIC_API_KEY".
 *
 * POZOR: nikdy nevrací hodnotu klíče – jen příznak existence.
 */
export function detectAiStatus(
  env: Record<string, string | undefined>,
  model: AiModelChoice = "opus",
): AiStatus {
  const keyEnv = AI_PROVIDERS[model].keyEnv;
  const base = detectKeyStatus(env, keyEnv);
  if (base.kind !== "skipped") return base;

  const alt = findAltProvider(env, keyEnv);
  if (alt) {
    return { kind: "skipped", reason: `${missingKeyReason(keyEnv)}; nalezen ${alt.keyEnv} – přidej --ai-model=${alt.model}?` };
  }
  return base;
}

/**
 * Reálné ověření AI cesty (za přepínačem `--ai-check`). Detekci klíče nechává na
 * čisté synchronní `detectAiStatus`; když klíč chybí, vrátí ten `skipped` BEZ
 * jakéhokoliv síťového volání. Když klíč je, pošle injektovaný `ping`:
 *   - resolve → `verified` (API odpovědělo).
 *   - chyba, kterou `classify` ZNÁ (síť/timeout/401/rate) → `skipped` s důvodem.
 *   - chyba, kterou `classify` NEzná (`null`) → probublá se stackem. Programová
 *     chyba (TypeError, neznámý stav) se NESMÍ maskovat jako „přeskočeno".
 *
 * `ping`/`classify` jsou injektované (ne přímý import SDK), aby (1) testy běžely
 * bez sítě a (2) default běh (jen `detectAiStatus`) vůbec nenahrával SDK.
 * Klíč čteme až tady (jediné legitimní místo) a NIKDY ho nevracíme v `AiStatus`.
 */
export async function verifyAiAccess(
  env: Record<string, string | undefined>,
  ping: (apiKey: string) => Promise<void>,
  classify: (err: unknown) => string | null,
): Promise<AiStatus> {
  // Ping je Anthropic-only (haiku) → gate přímo na Anthropic klíč, BEZ model-aware
  // cross-provider nápovědy (navrhovat glm u --ai-check by bylo matoucí). Tím zůstane
  // reason PŘESNĚ `AI_MISSING_KEY_REASON` a cli porovnání drží.
  const gate = detectKeyStatus(env, AI_KEY_ENV);
  if (gate.kind === "skipped") return gate;

  const apiKey = (env[AI_KEY_ENV] as string).trim();
  try {
    await ping(apiKey);
    return { kind: "verified" };
  } catch (err: unknown) {
    const reason = classify(err);
    if (reason === null) throw err;
    return { kind: "skipped", reason };
  }
}
