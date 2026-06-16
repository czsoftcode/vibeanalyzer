#!/usr/bin/env node
import process from "node:process";
import { run } from "./cli.js";

// Dedikovaný spustitelný vstup. Node tenhle soubor spouští jako program (přes
// `bin` v package.json), takže NENÍ co detekovat – run() voláme bez podmínek.
// Tím odpadá celá třída chyb kolem „jsem vstupní bod?" (isEntrypoint): knihovna
// `cli.ts` zůstává bez vedlejšího efektu a testy si ji můžou bezpečně importovat.
run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error("Neočekávaná chyba:", err);
    process.exitCode = 1;
  });
