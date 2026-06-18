import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { AskFn } from "./intentPrompt.js";

/** Dotazovač nad readline + způsob, jak rozhraní zavřít. */
export interface ReadlineAsk {
  ask: AskFn;
  close: () => void;
}

/**
 * Postaví `AskFn` nad readline. Vytaženo z bin.ts, aby šel most na readline
 * otestovat nad fake streamy (PassThrough), ne jen ručně v terminálu – je to
 * nejrizikovější část (hang, race close↔question, EOF).
 *
 * Kontrakt `ask`: vrátí jeden řádek odpovědi (readline ho dává BEZ koncového
 * terminátoru a zvládá i CRLF), nebo `null` na EOF/zavření rozhraní. Klíčové:
 * i KAŽDÉ volání po EOF vrátí `null` místo pádu – readline po `close` hází z
 * `question()` synchronně ERR_USE_AFTER_CLOSE; to odchytíme a chováme se jako EOF,
 * ať tichý invariant "po null už nevolej" nemusí hlídat volající.
 *
 * Rozhraní se vytvoří LÍNĚ až při prvním dotazu – běžný (neinteraktivní) běh tak
 * vůbec nesáhne na vstupní stream.
 */
export function createReadlineAsk(input: Readable, output: Writable): ReadlineAsk {
  let rl: readline.Interface | undefined;

  const ask: AskFn = (question) =>
    new Promise((resolve) => {
      if (!rl) {
        rl = readline.createInterface({ input, output });
      }
      const iface = rl;
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        iface.removeListener("close", onClose);
        resolve(value);
      };
      // EOF (Ctrl-D) zavře rozhraní → 'close' místo odpovědi: resolve null.
      const onClose = () => finish(null);
      iface.once("close", onClose);
      try {
        iface.question(`${question} `, (answer) => finish(answer));
      } catch {
        // Rozhraní už bylo zavřené (EOF v předchozím dotazu) → další dotaz nemá
        // odkud číst. Chováme se jako EOF (null), ne jako pád.
        finish(null);
      }
    });

  return { ask, close: () => rl?.close() };
}
