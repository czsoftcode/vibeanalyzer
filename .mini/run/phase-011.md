---
phase: 11
verdict: done
steps:
  - title: "Oříznout vedoucí odrážku u non-goalů"
    status: done
  - title: "Test 10-2: '- text' nedá '- - text'"
    status: done
  - title: "Vyčlenit testovatelnou výplň z bin.ts"
    status: done
  - title: "Test 10-1: close vždy + ask jen interaktivně"
    status: done
  - title: "Adversariální self-review + finální kontrola"
    status: done
---

# Fáze 11 — report z auto session

## Co se udělalo

**1. Oprava zdvojené odrážky (nález 10-2).** Do `intentPrompt.ts` přidána funkce `stripLeadingBullet`, která z hodnoty non-goalu odřízne JEDNU vedoucí odrážku `- `/`* `. Ořez je ve sběrové vrstvě (`collectIntentDraft`), ne v renderu — respektuje dokumentovaný kontrakt v `intentWriter.ts`, že `renderProjectMd` je čistý formátter a sanitizace patří vrstvě, co odpovědi sbírá. Test v `intentPrompt.test.ts` (vstup `- Nespouštět kód`, `* Nestavět web`) ověřuje round-trip přes render + `parseIntent`; má zuby (po odstranění ořezu padá).

**2. Vyčlenění testovatelné funkce z bin.ts.** Vznikl nový modul `src/cliMain.ts` s čistou funkcí `runCli(deps)` — bez vedlejšího efektu při importu (na rozdíl od `bin.ts`, který se spouští už importem, takže ho test nešel importovat). `runCli` orchestruje: zaručené `close()` rozhraní (finally), `ask` jen v interaktivu, věrný exit kód, pád → log + exit 1. `bin.ts` je teď tenký — jen poskládá reálné závislosti (`process`, `createReadlineAsk`, `run`) a zavolá `runCli`. Testy v `cliMain.test.ts` (6 případů) pokrývají interaktivní i ne-interaktivní cestu, pád run() i exit kódy; ověřeny mutací (zrušení `close` / guardu interaktivity testy chytí).

## Co našel nezávislý adversariální sub-agent (a opraveno)

Sub-agent (čerstvý kontext) našel reálný **major**, který jsem v prvním návrhu přehlédl: `createAsk()` byl MIMO `try` v `runCli` a z `bin.ts` jsem zároveň odebral původní `.catch`. Kdyby továrna na rozhraní vyhodila, skončilo by to jako `unhandledRejection` se spoléháním na Node default exit kód (může být i exit 0 = tichý falešný úspěch, porušení kontraktu CLAUDE.md).

Oprava:
- `deps.createAsk()` přesunuto DOVNITŘ `try` v `runCli` → funkce je teď totální (nikdy nezamítne), pád továrny projde stejnou cestou jako pád `run()` (log + exit 1).
- Do `bin.ts` vrácena tenká pojistka `.catch` (pro úplně nečekané, např. EPIPE z `console.error`).
- Doplněn chybějící test „pád createAsk() → exit 1 + log" — ten zub předtím v sadě chyběl (ani jednotkový, ani integrační test by regresi nechytl). Ověřeno mutací: s `createAsk` zpět mimo try test červená.

## Známé, vědomě ponechané omezení (nit)

`stripLeadingBullet` ořezává jen JEDNU úroveň odrážky. Exotický vstup `"- - x"` tak po renderu dá `"- - x"` a parser vrátí položku s vedoucí pomlčkou `"- x"`. Ponecháno schválně: opakovaný ořez by sežral i legitimní text typu `"- -5 až 5"` (pomlčka jako znaménko). Není to bezpečnostní problém (parser je fence/heading-aware), jen kosmetika u nepravděpodobného vstupu. Zdokumentováno v komentáři u funkce.

## Ověření

- `npx vitest run` → 156 testů zelených (18 souborů).
- `npm run typecheck` → bez chyb.
- `npm run build` → bez chyb.
- `cli.entrypoint.test.ts` upraven: izolační harness `runLauncherWith` teď kopíruje i reálný `dist/cliMain.js` (má jen `import type`, žádné runtime deps), takže launcher se testuje proti pravé orchestraci, ne stubu.

Žádné rozcestí hodné ADR — rozhodnutí „ořez ve sběru, ne v renderu" odsouhlasil uživatel už v plánu a sedí na existující kontrakt. Pro člověka není co vizuálně ověřovat (vše ověřeno mechanicky).
