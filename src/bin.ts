#!/usr/bin/env node
import process from "node:process";
import { run } from "./cli.js";
import { createReadlineAsk } from "./readlineAsk.js";

// Dedikovaný spustitelný vstup. Node tenhle soubor spouští jako program (přes
// `bin` v package.json), takže NENÍ co detekovat – run() voláme bez podmínek.
// Tím odpadá celá třída chyb kolem „jsem vstupní bod?" (isEntrypoint): knihovna
// `cli.ts` zůstává bez vedlejšího efektu a testy si ji můžou bezpečně importovat.

// Interaktivní jen když je stdin I stdout TTY. V ne-TTY (pipe, CI, přesměrování)
// dotazovač vůbec nevznikne a run() dostane isInteractive=false → nikdy se na nic
// neptá a nečeká na vstup, který by nikdo nezadal (žádný hang). Glue na readline
// je v readlineAsk.ts (testovatelná nad fake streamy).
const isInteractive = Boolean(process.stdin.isTTY) && Boolean(process.stdout.isTTY);
const rl = isInteractive ? createReadlineAsk(process.stdin, process.stdout) : undefined;

run(process.argv.slice(2), process.cwd(), { ask: rl?.ask, isInteractive })
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error("Neočekávaná chyba:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Pokud jsme se ptali, rozhraní zavřeme, ať proces nedrží otevřený stdin.
    rl?.close();
  });
