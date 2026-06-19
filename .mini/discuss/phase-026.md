# Phase 26 — Sjednotit filtr minifikátů v reportu

## Intent
Dotáhnout sdílený detektor `isMinifiedName` (`src/minified.ts`, z fáze 25) do
zbytku reportu, aby s minifikáty (`*.min.<ext>`, detekce JEN podle jména) nakládal
konzistentně a report si neprotiřečil (dnes ESLint bundle přeskočí, ale počet
souborů / seznam `## Soubory` / graf modulů / JSON index ho dál vypíšou).

Dotčená místa (ověřeno v kódu):
- **Počet „Souborů: N"** (`markdown.ts:562`) — dnes počítá i minifikáty.
- **Seznam `## Soubory`** (`markdown.ts:599-607`) — vypíše každý minifikát.
- **Graf modulů** (`analyze/moduleGraph.ts`) — malý `app.min.js` (pod 1 MiB) se
  dnes parsuje jako zdroják a stane se uzlem/hranou. Velký se přeskočí, ale jako
  `tooLarge` (podle VELIKOSTI, ne jména).
- **JSON index** (`report/jsonIndex.ts`) — nese surové pole `files`, tedy i minifikáty.
- **Mermaid „Struktura složek"** je MIMO rozsah — kreslí jen složky, ne jednotlivé
  soubory.

Mimo rozsah (samostatná pozdější věc): obsahová detekce dlouhých řádků pro bundly
bez `.min.` přípony (`bundle.js`).

## Key decisions
- **Označit, NE vyřadit.** Minifikát zůstane všude vypsaný/započítaný, jen dostane
  viditelnou značku „minifikát". Strukturální mapa pak nelže o tom, co fyzicky na
  disku je, a rozpor mizí tím, že je všude STEJNÁ značka (ESLint skip je vysvětlený).
  „Žádné tiché vynechání" splněno automaticky — nic se neskrývá.
- **Počty se rozpadnou**: místo `Souborů: N` → `Souborů: N (z toho M minifikátů)`
  (M=0 → buď bez dovětku, doladit v plánu).
- **Seznam `## Soubory`**: u minifikátů přidat značku (např. `[minifikát]`).
- **Graf modulů**: malý `.min.js` z grafu vyřadit (nekreslit hrany do/z bundlu) a
  počítat ho NOVÝM samostatným počítadlem `minified`, ODDĚLENĚ od `tooLarge`
  (velikost ≠ jméno) → mění tvar `ModuleGraphResult` (varianta `ran`).
- **JSON index**: označení = přidat na `FileEntry` příznak `minified: boolean`.
  Je to změna kontraktu JSONu → **bump `INDEX_VERSION` 7 → 8** (schváleno).

## Watch out for
- **Jediný zdroj pravdy = `isMinifiedName`.** Žádný holý regex v konzumentech;
  derivovat značku z `f.path` (basename) přes sdílenou funkci, ať se kontrakt
  nerozejde (stejný princip jako fáze 25). Zvážit drobný helper, ať každý konzument
  netahá `basename` zvlášť.
- **Kde příznak `minified` žije:** buď ho dopočítat na `FileEntry` (scan), nebo
  derivovat v konzumentech. Scan je dnes „čistá" filesystem fakta (path/type/ext/
  size); „minified" je report-level pojem. Rozhodnout v plánu, ale JSON kontrakt
  (`FileEntry.minified`) tak jako tak existovat musí.
- **V1 omezení (přiznané v `minified.ts`)**: detekce jen podle jména; `bundle.js`
  bez `.min.` filtrem projde. Report to už uvádí, hlídat konzistenci formulací.
- **Testy reportu/JSONu**: změna počtů, formátu seznamu, tvaru `ModuleGraphResult`
  a `INDEX_VERSION` rozbije existující fixtures → počítat s jejich úpravou.
- **Sebekontrola dle CLAUDE.md**: cross-module kontrakt (`isMinifiedName` ↔ všichni
  konzumenti, `INDEX_VERSION` ↔ JSON konzument) ověřit reálným kódem, ne jen mockem
  — když dočasně rozbiju regex/verzi, MUSÍ padnout test u každého konzumenta.
- Před reportem pustit nezávislého sub-agenta (čerstvý kontext) — fáze sahá na
  cross-module kontrakt mezi moduly i na JSON kontrakt.
