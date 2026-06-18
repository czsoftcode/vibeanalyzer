# Phase 13 — Strojová analýza: ESLint nálezy

**Goal:** Pustit ESLint nad analyzovaným projektem (hybridně z jeho node_modules, fallback přeskočit) a namapovat výsledky do existujícího modelu Finding a do téže sekce "Strojové nálezy" (md i JSON) jako tsc. Chybějící/rozbitý ESLint config, chybějící pluginy nebo nenačtitelný flat config → vrstva se čistě přeskočí (ne pád). Pozor na non-goal č. 1: flat config (eslint.config.js) je spustitelný JS – jeho načtení spustí kód projektu; jak s tím naložit se rozhodne v discuss. Ověření: schválně porušené lint pravidlo se objeví v reportu na správném soubor:řádek; projekt bez ESLint configu dá "ESLint přeskočeno".

## Steps
- [done] Rozšířit model o ESLint: source + EslintResult
- [done] Sekce ESLint v md + eslint v JSON
- [done] Přibalený ESLint config + závislosti
- [done] ESLint analyzátor: lint souborů -> Finding[]
- [done] Napojení do run() + hláška o rozsahu
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 13: Strojová analýza: ESLint nálezy

## Discussion
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

## Run report
---
phase: 13
verdict: done
steps:
  - title: "Rozšířit model o ESLint: source + EslintResult"
    status: done
  - title: "Sekce ESLint v md + eslint v JSON"
    status: done
  - title: "Přibalený ESLint config + závislosti"
    status: done
  - title: "ESLint analyzátor: lint souborů -> Finding[]"
    status: done
  - title: "Napojení do run() + hláška o rozsahu"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
verify:
  - title: "Reálný běh nad cizím JS/TS projektem (čitelnost a relevance nálezů)"
    detail: "Ověřeno strojově (208 testů, e2e najde eqeqeq i no-empty na správném řádku, bezpečnostní test dokazuje, že se cizí eslint.config.js nespustí). Co jsem NEzkoušel: běh nad velkým reálným projektem – jak relevantní/čitelné jsou nálezy a jestli ruleset netrefuje moc/málo. ZNÁMÁ mezera: minifikované/vendored .min.js mimo node_modules se lintují a můžou report zašumět (viz níže)."
---

# Phase 13 — report z auto session

## Co se povedlo
Druhá strojová vrstva vedle tsc. ESLint chytá logické bug-vzory, které jsou typově
v pořádku (== , prázdný catch, debugger, přiřazení v podmínce, duplicitní klíče,
nedosažitelný kód, fallthrough, nepoužité proměnné). Nálezy jdou do stejného modelu
Finding a do vlastní sekce "## Strojové nálezy (ESLint)" v md i pole `eslint` v JSON
(verze 3). Všech 6 kroků hotových, 208 testů zelených, typecheck i build čistý.

Odsouhlasená rozhodnutí z diskuse drží:
- **Náš pevný config, projektový eslint.config.js se NIKDY nenačítá** (`overrideConfigFile: true`).
  Bezpečnostní test reálně dokazuje, že se cizí config nespustí (žádný side-effect ani throw).
  ESLint jen parsuje na AST – kód projektu se nevykoná (stejný status jako tsc).
- **Jen correctness pravidla, žádný styl** (`src/analyze/eslintConfig.ts`).
- **Žádný --fix**, žádný zápis do projektu (ověřeno: nevznikne ani `.eslintcache`).
- **Závislosti** `eslint` + `@typescript-eslint/parser` v dependencies; bez TS pluginu.
- **Tři stavy odlišitelně** (N / čistý 0 / přeskočeno) v md i JSON; "ran 0" se neplete se "skipped".
- **Nálezy nemění exit kód**; selhání analyzátoru neshodí běh (skip + stderr se stackem).

## Co našel adversariální sub-agent (a co jsem opravil)
Nezávislý sub-agent (čerstvý kontext) reálnými běhy potvrdil bezpečnost (cizí kód se
nespustí, žádný zápis), neslévání stavů, exit kódy a degradaci unhappy path po jednom
souboru (parse error, TOCTOU). Našel 1 should-know hodný opravy + drobnost, opraveno:

1. **(should-know) Cross-module kontrakt přípon:** `LINTABLE_EXT` v analyzátoru a config globy
   byly dva oddělené literály. Při rozejití by soubor bez matchnutého configu dal fatal
   "no matching configuration" jako falešný "error" nález. Fix: JEDINÝ zdroj pravdy –
   `LINTABLE_EXTENSIONS` se exportuje z configu, globy se z něj odvozují, analyzátor ho
   importuje. Regresní test projede reálně každou příponu.
2. **(nit) Nepoužité eslint-disable direktivy** cizího projektu se hlásily jako warning
   (vůči našemu rulesetu jsou "nepoužité"). Fix: `reportUnusedDisableDirectives: "off"`. Test přidán.

## Známá omezení / vědomě neřešeno (V1)
- **Minifikované/vendored `.min.js` mimo `node_modules`** (a mimo skip-dirs dist/build) se
  lintují a můžou report zašumět (sub-agent: 1 takový soubor = 11 nálezů). Vědomě NEřeším
  filtrem podle názvu: je to heuristika, co může i mýlit, a nepadlo to v diskusi. Necháno
  na rozhodnutí uživatele v budoucí fázi (signál/šum). Uvedeno ve `verify`.
- **Bez tvrdého timeoutu** (konzistentní s tsc). ESLint je ale výrazně rychlejší než tsc.
- **5 transitivních zranitelností** přišlo s podstromem ESLint (npm audit: 3 moderate,
  1 high, 1 critical). `audit fix --force` nedělám (rozbil by major verze). K prověření.

## Pozn. pro další krok
Žádné nové zamítnuté rozhodnutí nad rámec discuss notes (bezpečný config vs spuštění
jejich configu je tam zaznamenáno) → `/mini:decision` netřeba.
