---
phase: 30
verdict: done
steps:
  - title: "Protáhnout jméno lockfilu do AuditOutput"
    status: done
  - title: "Předat lockfile do parseAuditJson a vulnToFinding"
    status: done
  - title: "Test 28-1: nález míří na npm-shrinkwrap.json"
    status: done
  - title: "Konzistentní counts ve fallbacku bez metadat (28-2)"
    status: done
  - title: "Test 28-2: fallback counts nelžou"
    status: done
  - title: "Nezávislý self-review + e2e"
    status: done
---

# Phase 30 — report z auto session

## Co bylo cílem
Dva nálezy reportingu auditu v `src/audit.ts`:
- **28-1** (should-know): `vulnToFinding` natvrdo psal `file: "package-lock.json"` i pro projekt s `npm-shrinkwrap.json` → report ukazoval na soubor, který v projektu není.
- **28-2** (nit): `readCounts` fallback (npm audit JSON bez `metadata.vulnerabilities`) vracel `total = N`, ale všechny závažnosti 0 → report lhal („N zranitelností, kritických 0, vysokých 0…").

## Co se udělalo
**28-1 – protáhnutí jména lockfilu skrz hranici modulů (cross-module kontrakt):**
- `AuditOutput` varianta `kind:"output"` nese nově `lockfile: string` (audit.ts:140).
- `collectAuditOutput` ho naplní z už zjištěného `findLockfile` výsledku (audit.ts:213).
- `parseAuditJson(stdout, lockfile)` → `vulnToFinding(name, raw, lockfile)` → `file: lockfile` místo natvrdo (audit.ts:310).
- `auditDependencies` předá `out.lockfile`. Reálná hodnota teče celou cestou, nikde nezůstává natvrdo ani default.
- `parseAuditJson` je veřejné API – povinný parametr `lockfile` (žádný default, aby se lež nevrátila tichým fallbackem); upravena přímá volání v `audit.parse.test.ts`.

**28-2 – konzistentní counts ve fallbacku:**
- `readCounts` fallback bez metadat teď dopočítá critical/high/moderate/low/info přímo z `vuln.severity` napříč `parsed.vulnerabilities` (audit.ts:332-358). Iteruje STEJNOU množinu vulns jako `findings` smyčka (`isObject` filtr) + switch má `default → info`, takže invariant `součet kategorií == total == findings.length` platí strukturálně za všech okolností (chybějící/null/neznámá severity → info).

## Ověření zubů (mutacemi)
- `file: lockfile` → natvrdo `"package-lock.json"` → padl přesně test 28-1, ostatní zelené.
- fallback counts → samé 0 → padl přesně test 28-2 (`toEqual` i invariant součet==total).

## Testy (reálný kód, ne mock)
- **28-1**: `audit.parse.test.ts` – přes REÁLNOU cestu `findLockfile→collectAuditOutput→parseAuditJson` (projekt má jen `npm-shrinkwrap.json`, injektovaný je jen síťový runner): `findings[0].file === "npm-shrinkwrap.json"`.
- **28-2**: report bez `metadata` s vulns 5 závažností (vč. neznámé → info): `counts === {critical:1,high:1,moderate:1,low:1,info:1,total:5}` + assert `součet kategorií == total`.

## E2e
- `npm test`: **373 passed (45 souborů)** (+2 nové).
- `npm run typecheck` (`tsc --noEmit`): čistý.
- `npm run build` (`tsc`): čistý.

## Nezávislý self-review (čerstvý sub-agent)
Sub-agent v čerstvém kontextu prošel cross-module kontrakt, oba invarianty, mutačně ověřil zuby a regresi metadata-cesty. **Žádný blocker.** Potvrdil, že reálná hodnota lockfilu teče celou cestou a invariant counts je strukturálně garantovaný.

## Pozor do budoucna / kandidát na backlog
**Render rozpisu auditu vynechává `info` (předchozí kvirk, NE regrese fáze 30):** `src/report/markdown.ts:289-290` vypisuje `total` a kategorie critical/high/moderate/low, ale **`info` nezobrazuje**. Když `info > 0`, zobrazený součet < `total` (čtenář vidí nesedící čísla). Tenhle rozpor v renderu existoval už před fází 30 (i metadata-cesta může mít `info > 0`). Oprava 28-2 ho ale nově **zaktivní i ve fallbacku** (vuln s neznámou/info severity → `info++`) – viz nový test 28-2 (`info:1, total:5`). Bylo vědomě mimo rozsah této fáze (28-2 cílil na `readCounts`, ne na render), ale stojí za samostatný todo: buď do rozpisu přidat `info`, nebo `total` počítat bez info. **Todo jsem nezakládal sám – nech na tobě.**

Veřejné `parseAuditJson("")` (prázdný lockfile) přijme i prázdný string; přes reálnou cestu se nestane (`findLockfile` vrací `null` → skip dřív). Kontrakt „neprázdné jméno" drží volající, ne funkce – záměrně bez extra validace, aby nemaskovala falešnou jistotu.
