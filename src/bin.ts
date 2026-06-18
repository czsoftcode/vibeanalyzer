#!/usr/bin/env node
import process from "node:process";
import { run } from "./cli.js";
import { runCli } from "./cliMain.js";
import { createReadlineAsk } from "./readlineAsk.js";

// Dedikovaný spustitelný vstup. Node tenhle soubor spouští jako program (přes
// `bin` v package.json), takže NENÍ co detekovat – orchestraci voláme bez podmínek.
// Veškerá logika (zaručené close, ask jen v interaktivu, exit kód) je v `runCli`
// (cliMain.ts), testovatelné bez TTY; tady jen poskládáme reálné závislosti na
// `process`/readline. Soubor má vedlejší efekt (spouští se importem), proto je
// tenký – testy importují cliMain.ts, ne tohle.

// Interaktivní jen když je stdin I stdout TTY. V ne-TTY (pipe, CI, přesměrování)
// dotazovač vůbec nevznikne a run() dostane isInteractive=false → nikdy se na nic
// neptá a nečeká na vstup, který by nikdo nezadal (žádný hang).
const isInteractive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);

runCli({
  argv: process.argv.slice(2),
  cwd: process.cwd(),
  isInteractive,
  createAsk: () => createReadlineAsk(process.stdin, process.stdout),
  run,
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    // runCli je totální (chytá i pád createAsk), takže sem se reálně nedostaneme.
    // Pojistka pro úplně nečekané (např. EPIPE z console.error v onUnexpected) –
    // ať vstupní bod NIKDY neskončí tichým exit 0 bez výsledku.
    console.error("Neočekávaná chyba:", err);
    process.exitCode = 1;
  });
