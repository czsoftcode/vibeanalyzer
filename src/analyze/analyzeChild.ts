import process from "node:process";
import type { EslintResult, TscResult } from "../findings.js";
import type { FileEntry } from "../scan.js";
import { analyzeESLint } from "./eslint.js";
import { analyzeTypeScript } from "./tsc.js";

/**
 * Vstupní bod IZOLOVANÉHO podprocesu (forkuje ho runIsolated). Spustí JEDNU
 * strojovou vrstvu (tsc nebo ESLint) v odděleném procesu s limitem paměti/času,
 * aby případný OOM/zaseknutí shodily jen tohle dítě, ne celý nástroj.
 *
 * POZOR (non-goal č. 1): tady běží NÁŠ kód (analyzeTypeScript/analyzeESLint), ne
 * kód analyzovaného projektu – izolace nezavádí žádné spouštění cílového kódu.
 */

/** Zadání od rodiče přes IPC. `files` jen pro ESLint (tsc si bere vstup z tsconfigu). */
export type ChildPayload =
  | { layer: "tsc"; root: string }
  | { layer: "eslint"; root: string; files: FileEntry[] };

async function handle(payload: ChildPayload): Promise<TscResult | EslintResult> {
  if (payload.layer === "tsc") {
    return analyzeTypeScript(payload.root, {
      onStart: (fileCount, source) => process.send?.({ type: "started", fileCount, source }),
    });
  }
  return analyzeESLint(payload.root, payload.files, {
    onStart: (fileCount) => process.send?.({ type: "started", fileCount }),
  });
}

// Spouštíme se JEN jako forknuté dítě (máme IPC kanál). Když nás něco jen
// naimportuje, `process.send` chybí a neuděláme nic.
if (process.send) {
  process.once("message", (payload: ChildPayload) => {
    handle(payload)
      .then((result) => {
        // počkáme na flush zprávy, pak čistý konec – až teď rodič ví, že je hotovo
        process.send?.({ type: "result", payload: result }, undefined, undefined, () => process.exit(0));
      })
      .catch((err: unknown) => {
        // výjimku NEspolkneme: stack na stderr (rodič ho přepošle jako „selhala")
        const e = err as Error;
        process.stderr.write(`${e?.stack ?? e?.message ?? String(err)}\n`);
        process.exit(1); // nenulový kód, BEZ OOM signatury → rodič to vyhodnotí jako bug, ne „příliš velký"
      });
  });
}
