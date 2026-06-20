# Phase 35 — Odmítnout prázdné --out=

**Goal:** parseArgs u --out= s prázdnou hodnotou vrátí kind: error se stejnou hláškou jako dvouargumentová forma, místo tichého zápisu do CWD; pokryto testem se zuby.

## Steps
- [done] Opravit větev --out= v parseArgs
- [done] Test se zuby: --out= je chyba
- [done] Ověřit, že happy path --out=cesta dál funguje
- [done] Doběh: tsc + ESLint + celá test suite zelené

## Auto-commit
- Phase 35: Odmítnout prázdné --out=

## Run report
---
phase: 35
verdict: done
steps:
  - title: "Opravit větev --out= v parseArgs"
    status: done
  - title: "Test se zuby: --out= je chyba"
    status: done
  - title: "Ověřit, že happy path --out=cesta dál funguje"
    status: done
  - title: "Doběh: tsc + ESLint + celá test suite zelené"
    status: done
---

# Phase 35 — report z auto session

## Co se udělalo
Opraven nález **1-6**: `parseArgs` u `--out=` s prázdnou hodnotou (`src/args.ts:53-63`)
nově vrací `{ kind: "error", message: "Volba --out vyžaduje cestu k adresáři." }`
místo aby prázdný řetězec propustil přes `path.resolve(cwd, "")` a tiše vysypal
report do CWD. Hláška je shodná s dvouargumentovou formou (`--out` bez hodnoty).

Přidán test se zuby `src/args.test.ts:31-34` (`--out= s prázdnou hodnotou je chyba`):
ověřuje přes `toEqual` celý výsledek včetně přesného textu hlášky, ne jen `kind`.
Testuje reálnou `parseArgs`, žádný mock.

## Ověření (mechanicky, mnou)
- **Zuby testu**: dočasně jsem vrátil rozbitou původní větev → nový test padl;
  po vrácení opravy prochází. Test reálně chytá regresi.
- **tsc** (`npm run typecheck`): čistý.
- **Happy path bez regrese**: existující test `--out= varianta funguje taky`
  (`src/args.test.ts:26`) zůstal zelený.
- **Celá suite** (`npm test`): 45 souborů / 382 testů zelených.
- **Exit kód** (nezávislý sub-agent): `kind: "error"` → `cli.ts` vrací 2 →
  `cliMain.ts` propouští → `bin.ts` nastaví `process.exitCode = 2`. Žádná chybová
  cesta nekončí tichým exit 0.

## Vědomé rozhodnutí mimo rozsah (zdokumentováno v kódu)
`--out=-x` (hodnota začínající pomlčkou) se NEodmítá, na rozdíl od dvouargumentové
formy, která `startsWith("-")` blokuje. Rozdíl je záměrný a okomentovaný v
`src/args.ts`: rovnítko hodnotu explicitně oddělilo, takže `--out=-x` jednoznačně
znamená adresář `-x` (žádné riziko spolknutí následujícího příznaku jako cesty).
Kontrola pomlčky u dvouargumentové formy existuje právě jen kvůli tomu spolknutí,
které u `=` nehrozí. Nález 1-6 byl konkrétně o prázdné hodnotě → CWD, ne o tomhle.

## ESLint
Projekt nemá vlastní `eslint.config.*` — ESLint je tu závislost pro analyzovanou
(strojovou) vrstvu, ne self-lint vlastních zdrojáků. Self-lint tedy není součástí
CI tohoto projektu (N/A); typecheck + celá test suite jsou zelené.

## Poznámky pro člověka
Nic k vizuální/UX kontrole. Vše ověřitelné mechanicky a ověřeno.
