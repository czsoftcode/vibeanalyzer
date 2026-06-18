import type { RunDeps } from "./cli.js";
import type { ReadlineAsk } from "./readlineAsk.js";

/**
 * Závislosti pro `runCli` – vše, co reálný vstupní bod (`bin.ts`) jinak sahá
 * natvrdo na `process`/readline. Vytaženo sem, ať jde orchestrace (zaručené
 * `close`, předání `ask` jen v interaktivu, exit kód) otestovat bez TTY a bez
 * vedlejšího efektu při importu – `bin.ts` se totiž spouští už importem.
 */
export interface CliMainDeps {
  /** Argumenty bez `node`/skriptu (běžně `process.argv.slice(2)`). */
  argv: readonly string[];
  /** Pracovní adresář (běžně `process.cwd()`). */
  cwd: string;
  /** True jen když je stdin I stdout TTY – jinak nabídku vůbec nespustíme. */
  isInteractive: boolean;
  /**
   * Továrna na dotazovač nad readline. Voláme ji JEN když `isInteractive` –
   * v ne-TTY rozhraní vůbec nevznikne (žádný sáhnutý stdin, žádný hang).
   */
  createAsk: () => ReadlineAsk;
  /** Vlastní běh CLI (injektovaný `run` z cli.ts). */
  run: (argv: readonly string[], cwd: string, deps: RunDeps) => Promise<number>;
  /** Logger nečekané chyby (default `console.error`). */
  onUnexpected?: (err: unknown) => void;
}

/**
 * Poskládá závislosti a spustí CLI. Vrací exit kód (volající ho přiřadí do
 * `process.exitCode` – funkce sama na `process` nesahá, ať je čistě testovatelná).
 *
 * Klíčové invarianty (proto je to vytažené a testované – nález 10-1):
 * - `close()` se zavolá PRÁVĚ JEDNOU a VŽDY, když rozhraní vzniklo: i když `run()`
 *   vyhodí výjimku (finally), jinak by otevřený stdin držel proces a po dotazu by se
 *   „zaseknul",
 * - dotazovač vznikne (a `ask` se předá) JEN v interaktivu; v ne-TTY je `ask`
 *   undefined a `run` se nikdy nezeptá,
 * - nečekaná chyba z `run()` → zaloguje se a vrátí exit kód 1 (žádný tichý exit 0).
 */
export async function runCli(deps: CliMainDeps): Promise<number> {
  // Rozhraní vzniká jen interaktivně; v ne-TTY zůstane undefined (nic se nezavírá).
  // `createAsk()` je ZÁMĚRNĚ uvnitř try: kdyby továrna vyhodila, projde stejnou
  // cestou jako pád run() (log + exit 1), ne jako unhandled rejection se spoléháním
  // na Node default (ten může být i exit 0). runCli je tím totální – nikdy nezamítne.
  let rl: ReadlineAsk | undefined;
  try {
    rl = deps.isInteractive ? deps.createAsk() : undefined;
    return await deps.run(deps.argv, deps.cwd, { ask: rl?.ask, isInteractive: deps.isInteractive });
  } catch (err: unknown) {
    (deps.onUnexpected ?? ((e) => console.error("Neočekávaná chyba:", e)))(err);
    return 1;
  } finally {
    // Pokud jsme se ptali, rozhraní zavřeme, ať proces nedrží otevřený stdin.
    rl?.close();
  }
}
