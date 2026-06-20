/**
 * Stav AI vrstvy PŘED reálným voláním API. V téhle fázi je to jen brána: zjistí,
 * jestli je k dispozici klíč. `ready` znamená POUZE „klíč nalezen", NE „API
 * odpovědělo" – reálný testovací dotaz přijde až v další fázi, proto schválně ne
 * „verified". Tvar je diskriminovaná unie jako u ostatních vrstev (tsc, audit, …),
 * aby ze strojového výstupu šlo poznat „přeskočeno" vs „připraveno".
 */
export type AiStatus = { kind: "skipped"; reason: string } | { kind: "ready" };

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
