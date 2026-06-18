---
phase: 17
verdict: done
steps:
  - title: "Predikát pod root + kontejnment parse hostu"
    status: done
  - title: "Filtr fileNames mimo root + hlučný nález + pravdivý důvod"
    status: done
  - title: "SEC-2: sanitizace loc v reportu"
    status: done
  - title: "Testy se zuby (3, padnou na starém kódu)"
    status: done
  - title: "Uzavřít SEC-3 bez kódu + zbytkový vektor 3 doložit"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
---

# Phase 17 — report z auto session

## Co se udělalo

**SEC-1 (should-know) — tsc nečte mimo root.** Tři vektory podvrženého `tsconfig.json`:

1. **`files`/`include` ven** (`../`, absolutní cesta) → filtr `cmd.fileNames` na cesty
   pod root *před* `createProgram`. Vynechané se hlásí jako warning `Finding`
   (`tsconfig odkazuje na soubor mimo kořen projektu – vynecháno…`), který teče do md
   i JSON. Když po filtru uvnitř nic nezbude, vrací se `skipped` s pravdivým důvodem
   (NE „prázdný projekt").
2. **`extends` ven** → vlastní `containedParseHost` místo `ts.sys` jako 2. argument
   `parseJsonConfigFileContent`. `readFile`/`fileExists` mimo root vrací undefined/false,
   takže se cizí soubor nepřečte; TS to ohlásí jako chybu konfigurace (TS5083 → Finding).
3. **Symlink uvnitř root mířící VEN** → **nález nezávislého review** (viz níže). Literální
   `isUnderRoot` ho neviděl, tak `isUnderRootReal`/`isUnderRootRealSync` rozplétají cestu
   přes `realpath` (na obou stranách, fail-closed). Pokryto jak filtr, tak parse host.

**SEC-2 (nit).** `renderFinding` čistí `loc` přes `sanitizeInline(formatLocation(f))` —
CR/LF v názvu souboru (na Linuxu legální) už nerozbije odrážku/nepodstrčí nadpis.

**SEC-3 (nit).** Bez kódu — supply-chain poznámka, review sám říká „žádná akce teď".

## Testy (8 nových, všechny se zuby — ověřeno rozbitím fixu)

- vektor 1 (files ven): `fileCount` se nepočítá z cizího souboru, místo toho warning.
- vektor 1 (symlink ven): `realpath` ho zachytí; na literálu by `fileCount=2` + TS2322 z cizího obsahu.
- vektor 2 (extends ven): `noUnusedLocals` z extends se neuplatní (žádné TS6133) + TS5083.
- všechny soubory mimo root → `skipped` s pravdivým důvodem (ne „prázdný projekt").
- SEC-2: `\n` v názvu souboru → md zůstane jednořádkové.

`tsc --noEmit` čistý, celá suita **235/235** zelená.

## Nezávislý adversariální review (sub-agent, čerstvý kontext)

Sub-agent našel reálnou díru, kterou původní plán i já jsme přehlédli: **symlink uvnitř
root mířící ven** obcházel literální `isUnderRoot` a vtahoval obsah cizího souboru do
reportu (ověřil reálným během, `fileCount=2`, TS2322 z `secret.ts`). Protože je to **stejný
vektor 1**, který fáze tvrdí, že zavírá (ne nový mechanismus), jsem ho **opravil** přidáním
`realpath`, ne odložil jako „zbytkový". Doplněn zubatý test.

Review jinak potvrdil čisté: hranice `isUnderRoot` (`/root` vs `/root-evil`), case-folding,
extends reálně zadržen, žádný tichý falešný úspěch v chybových větvích, Finding bez `file`
protéká do md i JSON, SEC-2 v JSON neaplikovatelné (`JSON.stringify` escapuje `\n`).

## Vědomě NEŘEŠENO (zbytková rizika, zdokumentováno v kódu — `tsc.ts`)

- **Vektor 3:** `import` / `/// <reference path="../..">` UVNITŘ zdrojáků přes
  `createProgram` s default hostem může resolverem sáhnout mimo root. Vlastní CompilerHost
  by hrozil rozbitím načítání lib/@types (legitimně leží mimo root). Mimo V1 rozsah.
- **`readDirectory` (include glob):** necháváme procházet `ts.sys`, takže může enumerovat
  JMÉNA souborů mimo root (slabý existence-oracle). OBSAH se ale nevtáhne — výsledky
  projdou filtrem `fileNames`. Nízká priorita.

## Na co si dát pozor (pro reviewera/další fázi)

- **Fail-closed v `isUnderRootReal`:** když `realpath` selže (rozbitý symlink, práva),
  soubor se VYNECHÁ. To je bezpečnější směr, ale teoreticky může zahodit legitimní soubor
  při exotickém FS stavu — vědomý trade-off.
- **`realpathSync` v parse hostu** přidá syscally do parsování tsconfigu (málo souborů,
  zanedbatelné). Pro neexistující cesty hází → catch → false, což je pro `fileExists`
  korektní (soubor neexistuje).
- Symlink test používá `symlink()` — na Windows bez práv by selhal; běží se na Linuxu.

Žádná zásadní křižovatka s odmítnutou alternativou → `/mini:decision` nepokládám za nutné
(volba realpath vs. punt je popsaná zde i v kódu).
