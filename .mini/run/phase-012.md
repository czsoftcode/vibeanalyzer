---
phase: 12
verdict: done
steps:
  - title: "Datový model nálezu + tsc-result typ"
    status: done
  - title: "Sekce Strojové nálezy v md + findings v JSON"
    status: done
  - title: "Hybridní načtení TypeScriptu + přesun do dependencies"
    status: done
  - title: "tsc analyzátor: tsconfig -> diagnostika -> Finding[]"
    status: done
  - title: "Napojení do run() + hláška o rozsahu"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
verify:
  - title: "Reálný běh nad cizím JS/TS projektem (vizuální kontrola reportu)"
    detail: "Testy i ad-hoc běhy ověřeny strojově (185 testů zelených, e2e najde úmyslnou TS2322 na správném řádku). Co jsem NEzkoušel: běh nad velkým reálným projektem s nainstalovaným node_modules (source 'project', desítky nálezů, čitelnost sekce v GitHub/VS Code náhledu) a nad projektem s pnpm symlinky."
---

# Phase 12 — report z auto session

## Co se povedlo
Report má první skutečné nálezy: tsc (jen type-check, nic nespouští) píše do nové
sekce `## Strojové nálezy (tsc)` v `.md` i do pole `tsc` v JSON indexu (verze 2).
Všech 6 kroků hotových, 185 testů zelených, typecheck i build čistý.

Klíčová rozhodnutí podle diskuse drží:
- **Hybridní tsc** (`src/analyze/loadTypescript.ts`): verze z `node_modules` cíle, fallback na přibalený. `typescript` přesunut do `dependencies`.
- **Nikdy neinstaluje**, NIKDY nezapisuje do projektu – ověřeno během s `composite/incremental/tsBuildInfoFile/outDir`: po analýze ve složce nevznikl žádný `.tsbuildinfo` ani `dist` (vynucený `noEmit` + vypnutý incremental/composite).
- **Tři stavy odlišitelně**: "N nálezů" / "čistý (0)" / "přeskočeno (důvod)". "ran s 0" se neplete se "skipped" ani v md, ani v JSON.
- **Nálezy nemění exit kód** (i 50 typových chyb = exit 0); chybové cesty vibeanalyzeru dál vrací exit 1.
- Chybějící `node_modules` se v reportu čestně přizná (chyby "nenalezený modul" jsou očekávané).

## Co našel adversariální sub-agent (a co jsem opravil)
Pustil jsem nezávislého sub-agenta (čerstvý kontext) dle CLAUDE.md. Našel 1 reálný
must-fix + 2 související should-know, všechny opraveny a pokryty regresními testy:

1. **(must-fix) Tichý falešný úspěch:** chyby konfigurace (`extends` na neexistující soubor, neznámá volba) se zahazovaly, když tsconfig zahrnul aspoň jeden soubor → report tvrdil "0 nálezů" nad rozbitým configem. Fix: `cmd.errors` (kromě TS18003) se teď mapují do nálezů i v "ran" větvi. Testy: TS5083, TS5023.
2. **(should-know) Lživý důvod:** prázdný tsconfig hlásil "chyba konfigurace", i když jen nebyly soubory. Fix: TS18003 oddělen jako stav → reason "tsconfig nezahrnul žádné soubory". Test přidán.
3. **(should-know) pnpm:** symlinkované `node_modules` → verze TS projektu se nikdy nepoužila (guard porovnával nerozbalenou cestu proti realpath z `require.resolve`). Fix: hranice se počítá z `realpath(node_modules)`.
4. **(nit) Catch v `run()`** nově vypisuje stack (ne jen message) – programovou chybu v mapování aspoň poznáme ze stderr, i když report neshazujeme.
5. **(nit) Backtick v cestě** souboru by rozbil inline code span → v `renderFinding` se nahradí.

## Známá omezení (vědomá, V1)
- **Bez timeoutu** u tsc (dle diskuse): u obřího monorepa může běh viset. Před během se vypíše "spouštím tsc nad N souborů".
- Catch kolem analyzátoru maskuje i programové chyby jako "tsc selhal" (ale nahlas na stderr se stackem). Vědomý kompromis: report nemá kvůli bugu v mapování spadnout.
- Jen kořenový `tsconfig.json`. Monorepo s víc configy = později.

## Pozn. pro další krok
Padlo rozhodnutí zamítnout `npm install`/sandbox/docker (spouští cizí kód = porušení non-goalu) – už zaznamenáno v `.mini/discuss/phase-012.md`. Není potřeba `/mini:decision`.
ESLint vrstva (druhá půlka původní todo 3) čeká v `mini todo`.
