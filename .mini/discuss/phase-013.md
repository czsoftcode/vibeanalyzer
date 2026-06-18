# Phase 13 — Strojová analýza: ESLint nálezy

## Intent
Druhá strojová vrstva vedle tsc (fáze 12): ESLint chytá LOGICKÉ bug-vzory, které
jsou typově v pořádku, a tsc je proto nevidí (== místo ===, prázdný catch,
zapomenutý debugger/console, omylem přiřazení v podmínce, duplicitní klíče,
nedosažitelný kód, fallthrough, nepoužité proměnné když projekt nemá noUnusedLocals).
Nálezy jdou do stejného modelu Finding a do reportu (md + JSON), jako u tsc.

## Key decisions
- **NÁŠ pevný config, projektový config se NIKDY nenačítá** (ESLint `overrideConfigFile: true`).
  Důvod: načtení `eslint.config.js` (flat config) by SPUSTILO projektem-autorovaný JS na
  stroji uživatele → porušení non-goalu č. 1 + bezpečnostní plocha u neznámých/nepřátelských
  repozitářů. Parsování zdrojáků ESLintem ale kód NEvykonává (jen AST) → s naším configem
  je to stejně bezpečné jako tsc. Nálezy jsou "dle vibeanalyzeru", ne dle pravidel projektu –
  to je vědomá cena, pro kontrolu AI kódu přijatelná.
- **Jen correctness / pravděpodobné bugy, ŽÁDNÝ styl.** Kurátorovaný malý ruleset:
  eqeqeq, no-empty, no-debugger, no-cond-assign, no-dupe-keys, no-dupe-args, no-unreachable,
  no-fallthrough, no-unused-vars, no-constant-condition, no-self-compare apod. Plný
  eslint:recommended ani styl NE (šum + překryv s tsc). Formátování řeší prettier, ne my.
- **Žádný hybrid (na rozdíl od tsc).** Používáme NÁŠ přibalený ESLint + config; verzi ani
  node_modules projektu nesaháme. Jednodušší než tsc loader.
- **Závislosti do dependencies:** `eslint` + `@typescript-eslint/parser` (parser je nutný,
  aby šlo vůbec rozparsovat .ts). Typový PLUGIN (@typescript-eslint/eslint-plugin) NE –
  jeho silná pravidla (no-floating-promises) potřebují typovou informaci = stavět TS program
  jako tsc (těžké, závislé na tsconfigu). V1 jen jádrová syntaktická pravidla nad TS parserem.
- **Soubory z NAŠEHO scanu** (respektuje .gitignore), filtrované na JS/TS přípony
  (.js/.jsx/.mjs/.cjs/.ts/.tsx/.mts/.cts). Ne z projektového configu (ten neřešíme).
- **Report: paralelní struktura k tsc.** Finding.source rozšířit na "tsc" | "eslint".
  Vlastní sekce + diskriminovaný výsledek EslintResult (skipped | ran s findings), stejné
  tři stavy odlišitelně (N nálezů / čistý 0 / přeskočeno). JSON index dostane pole `eslint`
  → bump INDEX_VERSION 2 → 3.
- **Bez --fix.** Jen report, nikdy neopravuje (non-goal "do not auto-fix") a nezapisuje do projektu.

## Watch out for
- **Non-goal č. 1:** ESLint s naším configem NESMÍ načíst projektový eslint.config.js
  (overrideConfigFile: true) ani plugin/parser resolvovat podle jména z jejich node_modules –
  parser i pravidla předáváme jako naše importované objekty ve flat configu, ne názvem.
  Ověřit: hostile eslint.config.js ve fixtuře se NESPUSTÍ.
- **"ran s 0 nálezy" ≠ "skipped".** Stejný kontrakt jako tsc – tři stavy se nesmí slít
  (tichý falešný úspěch). Skip důvody u ESLint: žádné JS/TS soubory / interní selhání ESLint.
- **Selhání ESLint NESHODÍ běh:** catch v run() jako u tsc → skipped + nahlas na stderr
  (se stackem), exit kód se nemění. Nálezy v projektu nemění exit kód.
- **no-unused-vars** má na TS false-positives (type-only použití). Buď ho pro .ts vypnout,
  nebo přijmout; rozhodnout v plánu (bez TS pluginu nemáme jeho lepší variantu).
- **Cross-module kontrakt:** INDEX_VERSION (2→3) a Finding.source rozšíření sdílí víc modulů
  → konstanta + test reálného kódu, ne mock.
- **Velký projekt:** ESLint nad mnoha soubory může chvíli trvat (jako tsc). Před během
  vypsat "spouštím ESLint nad N soubory". Bez tvrdého timeoutu (konzistentní s tsc, V1).
- **Rerange/parse chyby:** exotická syntaxe, kterou náš parser neumí, nesmí shodit – jeden
  soubor selže → buď nález "nešlo rozparsovat", nebo přeskočit ten soubor, ostatní doběhnou.

## Verification
Schválně porušené pravidlo (např. `if (a == b)` nebo prázdný `catch {}`) se objeví v
reportu na správném soubor:řádek; projekt bez JS/TS souborů dá "ESLint přeskočeno";
fixture s nepřátelským eslint.config.js dokazuje, že se config NEspustí.
