# Phase 5 — Třetí zdroj záměru: ~/.vibeanalyzer

**Goal:** Rozšířit lokalizaci project.md o čtení z ~/.vibeanalyzer/<název projektu>/project.md jako fallback po .mini/project.md a project.md v cíli; když není ani tam, report jede dál s 'záměr nedodán' (beze změny interaktivity). V discuss/plan vyřešit odvození <název projektu> (basename vs. hash cesty vs. plná cesta jako klíč).

## Steps
- [done] Funkce projectKey(targetPath) + test
- [done] Sestavení cesty k domácímu fallbacku
- [done] Zařadit třetího kandidáta do loadIntent
- [done] Read-only kontrakt potvrzen
- [done] Testy unhappy path nad reálným fixturem
- [done] Sebekontrola + typecheck + nezávislý sub-agent

## Auto-commit
- Phase 5: Třetí zdroj záměru: ~/.vibeanalyzer

## Run report
---
phase: 5
verdict: done
steps:
  - title: "Funkce projectKey(targetPath) + test"
    status: done
  - title: "Sestavení cesty k domácímu fallbacku"
    status: done
  - title: "Zařadit třetího kandidáta do loadIntent"
    status: done
  - title: "Read-only kontrakt potvrzen"
    status: done
  - title: "Testy unhappy path nad reálným fixturem"
    status: done
  - title: "Sebekontrola + typecheck + nezávislý sub-agent"
    status: done
---

# Phase 5 — report z auto session

## Co je hotové
`loadIntent` teď hledá záměr ve třech místech v pořadí: `<cíl>/.mini/project.md` →
`<cíl>/project.md` → `~/.vibeanalyzer/<projectKey>/project.md`. Když není nikde,
report jede dál (`absent`, „záměr nedodán"); nečitelný kandidát (práva, adresář
místo souboru) = `unreadable` a hledání se zastaví (reálný problém s právy se
neschová za fallback). Žádná interaktivita se nezměnila.

Klíč `projectKey(targetPath)` = `basename-<8 hex SHA-1 absolutní cesty>`.
`path.resolve` dělá klíč idempotentní (`./app` i `/abs/app` → stejný), hash drží
oddělené projekty se stejným jménem (žádné čtení cizího záměru). Pro testovatelnost
má `loadIntent` volitelný `options.homeDir` (default `os.homedir()` přes defenzivní
`safeHomedir`); volání v `cli.ts` zůstalo beze změny.

Ověřeno: typecheck čistý, celá sada 82 testů zelená, end-to-end self-run nástroje
nad vlastním repem projde (exit 0, záměr se načte z `.mini/project.md`, do repa se
nic nezapíše). Testy mají zuby – ověřeno dočasným rozbitím kódu: `projectKey` bez
hashe shodí kolizní testy, vyhození domácího kandidáta shodí domácí testy,
`defaultOutDir` zpět na basename shodí 3 testy.

## Důležité rozhodnutí během fáze (rozpor s args.ts)
Nezávislý sub-agent (čerstvý kontext) odhalil reálný rozpor: `args.defaultOutDir`
už psal **report** do `~/.vibeanalyzer/<basename>` (jen jméno), kdežto tato fáze
četla **záměr** z `~/.vibeanalyzer/<basename>-<hash>/`. Dvě schémata pod jedním
kořenem = jeden projekt by měl report a záměr ve dvou různých složkách (a navíc
latentní kolize výstupů: dva projekty `app` z různých cest si přepíšou report).

Po dotazu jsi zvolil **sjednotit na `projectKey`**. Provedeno: klíč žije ve sdíleném
`src/projectPaths.ts` (vlastník kontraktu), importují ho `args.ts` i `intent.ts`,
takže `args` nezávisí na `intent`. `defaultOutDir` teď taky používá `projectKey` →
report i záměr leží v jedné složce `~/.vibeanalyzer/<projectKey>/`. Při tom opraven
i okrajový případ kořene `/` (prázdný basename → prefix `root`, ne holá pomlčka).

→ Stojí za zápis přes `/mini:decision` před `/mini:done`: *proč* je úložiště
keyované `basename-hash` (čitelnost + kolizní bezpečnost) a proč klíč žije ve
sdíleném modulu, ne v jednom z konzumentů.

## Co se nezměnilo / co řešit dál
- READ-ONLY drží: fáze nikam nezapisuje (žádné mkdir/writeFile na produkční cestě).
  Soubor `~/.vibeanalyzer/<key>/project.md` zatím nikdo netvoří – **zápis přijde
  v navazující interaktivní fázi** (mini todo) a MUSÍ použít stejný `projectKey`.
- `safeHomedir` má obranný catch, který je v praxi téměř nedosažitelný (`os.homedir()`
  spíš vrací prázdný string než hází). Větev „prázdný domov → kandidát vypadne" je
  pokrytá přes `homeDir: ""`; samotný catch ne (nejde snadno vyvolat). Nit, neblokuje.
- Help/varování v `cli.ts` jsem nerozšiřoval o třetí lokaci – tip stále radí
  `.mini/project.md`, což je správné primární místo pro uživatele. Domácí úložiště
  je interní cache plněná až write fází; zmiňovat ho v nápovědě teď by mátlo.
