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
