---
phase: 27
verdict: done
steps:
  - title: "Rozšířit SecretsResult o počitadla skipů"
    status: done
  - title: "Počítat skipy v scanSecrets"
    status: done
  - title: "Report: řádek přeskočených v secretsSection"
    status: done
  - title: "JSON index: bump verze 8 → 9"
    status: done
  - title: "Nezávislý self-review + e2e"
    status: done
---

# Phase 27 — report z auto session

## Co se udělalo
Secrets vrstva přestala tiše přeskakovat balast. Přidal jsem do `SecretsResult`
(ran varianta) nové pole `skipped: { minified, large, binary, longLine }`
(typ `SecretsSkipped` v `src/secrets.ts`). `scanSecrets` teď na každém **záměrném**
`continue` inkrementuje příslušné počítadlo. Report (`secretsSkippedLine`
v `markdown.ts`) vypisuje řádek vždy — i s nulami (`Přeskočeno 0 souborů jako
balast.`), takže žádné tiché vynechání. JSON index nese `skipped` 1:1 a verze
bumpnutá 8 → 9.

## Co se VĚDOMĚ NEpočítá (hranice rozsahu, schválená v cíli fáze)
I/O selhání (`stat`/`readFile` hodí) se do `skipped` netahá. Není to filtr balastu,
ale chyba čtení — a `scanTree` ji hlásí samostatně. Mít to v jedné sumě by zamlžilo
význam čísla. Tyhle dvě `continue` větve zůstaly bez počítadla a jsou tak
okomentované v kódu.

## Zuby testů (ověřeno reálnou mutací, ne jen mockem)
- `secrets.scan.test.ts`: každá ze 4 kategorií má test na konkrétní počet. Když
  smažu daný `skipped.X++`, počet zůstane 0 a test padne. Plus nový kombinovaný
  test (minifikát + velký + dlouhý řádek + čistý) ověřuje mutuální výlučnost přes
  `toEqual` na celém objektu.
- `markdown.secrets.test.ts`: test ověřuje **konkrétní čísla** v reportu
  (`minifikáty: 2`, součet `8`), ne jen přítomnost slova „přeskočeno". Plus test na
  nulový řádek.
- `jsonIndex.test.ts`: verze 9, `skipped` projde 1:1 (fixtura s nenulovými počty).

## Nezávislý self-review (čerstvý kontext) — nález N1, OPRAVENO
Pustil jsem red-team sub-agenta na cross-module a JSON kontrakt. Reálnou mutací
ověřil zuby všech počítadel, verze i reportu (vše drží). Našel **jednu nepřesnost,
kterou můj checklist minul**:

- **N1 (should-know) — OPRAVENO.** Pořadí kategorií v dokumentaci typu a v rozpadu
  reportu bylo `minified → large → longLine → binary`, ale **reálné pořadí kontrol**
  ve `scanSecrets` je `minified → large → binary → longLine` (NUL test je před testem
  dlouhého řádku). Mutuální výlučnost se neporušuje (každá větev má `continue`), ale
  soubor, co je zároveň binárka i má dlouhý řádek, padne do `binary` — opačně, než
  dokumentace implikovala → matoucí interpretace čísel. Fix: sjednotil jsem pořadí
  polí typu, init objektu, rozpad v reportu i doc v `jsonIndex.ts` na reálné pořadí
  kódu (`minified → large → binary → longLine`) a přidal komentář, že pořadí kopíruje
  pořadí kontrol.

Sub-agent jinak potvrdil: žádná cesta tichého vynechání (každý kandidát končí ve
`fileCount`, v některé `skipped` kategorii, nebo v záměrném I/O catch), dedup `.env`
drží, hranice 1 MiB (striktní `>`) a prázdný soubor se chovají správně.

## Mechanická verifikace
- `npm run build` (tsc) čistý.
- `npm test`: 364 testů zelených (45 souborů).
- Reálný e2e běh CLI na temp složce s `app.min.js`: report `.md` ukázal řádek
  „Přeskočeno 1 souborů jako balast (minifikáty: 1, …)", JSON nese
  `secrets.skipped = {minified:1,large:0,binary:0,longLine:0}` a `version: 9`.

## Poznámky / drobnosti
- `src/secrets.scan.test.ts` git hlásí jako binární soubor — to je
  **předexistující** stav (test binárky na ř. 88 schválně vkládá NUL bajty do obsahu
  `blob.bin`), ne nic z této fáze.
- Projekt nemá `lint` npm skript; „lint" v plánu = `typecheck` (tsc), který prošel.
- Sub-agent po sobě uklidil všechny dočasné mutace; pracovní strom obsahuje jen
  záměrné soubory fáze 27.

## Pro člověka
Není co vizuálně ověřovat — vše šlo zkontrolovat mechanicky (testy + reálný běh CLI).
Žádný rozcestník vyžadující ADR (rozhodnutí „I/O se nepočítá" bylo součástí cíle
fáze, ne nově zvážená alternativa).
