import Anthropic from "@anthropic-ai/sdk";

/**
 * Levný model pro pouhé OVĚŘENÍ dostupnosti AI cesty (klíč + síť + auth) před
 * fází 6. Natvrdo konstanta – non-goal projektu zakazuje konfigurační soubor.
 */
export const AI_MODEL = "claude-haiku-4-5";

/**
 * Strop čekání na odpověď API. POZOR: TS SDK bere timeout v MILISEKUNDÁCH.
 * Pro pouhý ping schválně krátký – síťový problém má přeskočit rychle, ne viset.
 */
export const AI_PING_TIMEOUT_MS = 10_000;

/**
 * Reálný testovací dotaz na API. Resolve = API odpovědělo (HTTP 200) → „ověřeno".
 * Obsah odpovědi schválně NEkontrolujeme (string-match na text je křehký – model
 * může odpovědět cokoliv); stačí, že volání prošlo bez chyby.
 *
 * `maxRetries: 0` je záměr: default SDK je 2 a retry-uje i timeouty, takže reálné
 * čekání by bylo až `timeout × 3`. Pro pre-check chceme rychlé selhání, ne vytrvalé
 * opakování. Chyby tady NEodchytáváme – necháme je probublat ke `classifyAiError`,
 * která rozhodne „přeskočit" vs „programová chyba".
 */
export const realAiPing = async (apiKey: string): Promise<void> => {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: AI_PING_TIMEOUT_MS });
  await client.messages.create({
    model: AI_MODEL,
    max_tokens: 16,
    messages: [{ role: "user", content: "ping" }],
  });
};

/**
 * Zatřídí chybu z pingu: vrátí KONKRÉTNÍ důvod přeskočení pro očekávané provozní
 * chyby (síť / timeout / odmítnutý klíč / rate limit), nebo `null` pro cokoliv
 * nečekaného (programová chyba, neznámý API stav). `null` se NESMÍ tvářit jako
 * „přeskočeno" – volající ho probublá se stackem (tichý falešný úspěch = nález).
 *
 * Pořadí `instanceof` je důležité: APIConnectionTimeoutError dědí z
 * APIConnectionError, takže timeout testujeme dřív.
 */
export function classifyAiError(err: unknown): string | null {
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return "časový limit při dotazu na API vypršel";
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "síťová chyba při dotazu na API";
  }
  if (err instanceof Anthropic.AuthenticationError) {
    return "API odmítlo klíč (neplatný ANTHROPIC_API_KEY)";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "API hlásí překročení limitu (rate limit)";
  }
  return null;
}
