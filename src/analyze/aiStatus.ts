/**
 * Stav AI vrstvy. Tři rozlišitelné stavy (diskriminovaná unie jako u ostatních
 * vrstev – tsc, audit, …), aby ze strojového výstupu šlo poznat, co se stalo:
 *   - `skipped`  – AI neproběhla (chybí klíč, síť/timeout, odmítnutý klíč) + důvod.
 *   - `ready`    – klíč nalezen, ale reálný dotaz NEPROBĚHL (default běh bez
 *                  `--ai-check`). NE falešné „hotovo".
 *   - `verified` – reálný testovací dotaz na API proběhl (jen s `--ai-check`).
 *                  Schválně ne dřív: `ready` ≠ „ověřeno".
 */
export type AiStatus =
  | { kind: "skipped"; reason: string }
  | { kind: "ready" }
  | { kind: "verified" };

/** Jméno env proměnné s klíčem k Anthropic API. Sdílený literál (kontrakt). */
export const AI_KEY_ENV = "ANTHROPIC_API_KEY";

/** Důvod přeskočení, když klíč chybí. Sdílený s reportem (markdown/JSON) i testy. */
export const AI_MISSING_KEY_REASON = `chybí ${AI_KEY_ENV}`;

/**
 * Čistá detekce nad PŘEDANÝM prostředím (ne přímo `process.env` – aby šla
 * testovat bez globálního stavu). Klíč chybějící, prázdný nebo jen z whitespace
 * → `skipped` s konkrétním důvodem; jinak `ready`.
 *
 * POZOR: funkce nikdy nevrací hodnotu klíče – jen příznak, že existuje. Klíč je
 * tajemství a nesmí se dostat do perzistovaného reportu.
 */
export function detectAiStatus(env: Record<string, string | undefined>): AiStatus {
  const raw = env[AI_KEY_ENV];
  if (raw === undefined || raw.trim() === "") {
    return { kind: "skipped", reason: AI_MISSING_KEY_REASON };
  }
  return { kind: "ready" };
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
  const gate = detectAiStatus(env);
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
