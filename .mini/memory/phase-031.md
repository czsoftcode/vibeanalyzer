# Phase 31 — Render auditu: zobrazit info

**Goal:** Doplnit do rozpisu npm auditu v src/report/markdown.ts kategorii info, aby zobrazený součet kategorií seděl s total i když info > 0, s testem nad nálezem s nenulovým info.

## Steps
- [done] Přidat info do věty rozpisu auditu
- [done] Test: render s nenulovým info
- [done] Self-kontrola happy/unhappy path
- [done] Spustit testy + build

## Auto-commit
- Phase 31: Render auditu: zobrazit info

## Run report
---
phase: 31
verdict: done
steps:
  - title: "Přidat info do věty rozpisu auditu"
    status: done
  - title: "Test: render s nenulovým info"
    status: done
  - title: "Self-kontrola happy/unhappy path"
    status: done
  - title: "Spustit testy + build"
    status: done
---

# Phase 31 — report z auto session

## Co se udělalo
- `src/report/markdown.ts` (`auditSection`, řádek ~290): do souhrnné věty „npm audit našel … zranitelností" doplněna kategorie **„informativních {c.info}"**. Teď platí, že součet zobrazených kategorií (critical + high + moderate + low + info) = `c.total` i když `info > 0`. Dřív se `info` do `total` počítalo, ale ve větě se nezobrazovalo → čtenář viděl nesedící čísla (kandidát z toda 23).
- `src/report/markdown.audit.test.ts`: přidán test „info > 0 → rozpis ukáže info a součet kategorií sedí s total". Test **nemá jen substring kontrolu** – regexem vytáhne všech pět čísel z vykreslené věty a ověří `critical+high+moderate+low+info === total` (case `info:1, total:5`).

## Ověření (vše mechanicky)
- `npx tsc --noEmit` → exit 0.
- Celá sada: **374 testů / 45 souborů prošlo**.
- Zuby testu ověřeny: dočasné odebrání `info` z věty → nový test spadl (1 failed); po vrácení zase zelený.
- Ruční render fixture (`info:2, total:3`): `… (kritických 0, vysokých 1, středních 0, nízkých 0, informativních 2).` → součet 3 = total. Sedí.

## Self-kontrola (CLAUDE.md)
- **Konzumace counts jinde:** `src/report/jsonIndex.ts` `counts` ani znění věty nepoužívá (grep prázdný) – jediný renderer věty je `markdown.ts`. `audit.parse.test.ts:80` je jen komentář, ne závislost na textu.
- **Unhappy path:** cesty `skipped` a „ran s 0 nálezy" se vrací před/za větou beze změny; pro `info=0` věta dál dává smysl („informativních 0"). Žádná chybová větev se nedotkla, žádné nové exit kódy.
- Změna je čistě v renderu (text), nemění `AuditCounts` ani jeho výpočet → konzistence metadata-cesty i fallbacku zachována (fallback `total = findings.length`, info se dopočítává v `audit.ts`).

## Drobnost k poznámce
- Během ověření zubů jsem omylem použil `git checkout src/report/markdown.ts`, čímž se neuložená editace (přidání `info`) vrátila na poslední commit a test krátce zůstal červený. Odhaleno hned, změna znovu nasazena, finální sada je zelená. Pracovní strom teď změnu obsahuje (`git status`: M markdown.ts, M markdown.audit.test.ts). Žádný trvalý dopad, jen poznámka, proč v logu jedno mezikolo ukazovalo „1 failed" i po „obnově".

Žádná netriviální rozhodovací křižovatka → ADR (`/mini:decision`) není potřeba.
