# Phase 17 — Zadržení tsc v kořeni projektu

**Goal:** Opravit SEC-1 (tsc přes podvržený tsconfig nesmí číst soubory mimo root – odfiltrovat/ohlásit cesty z files/extends mířící ven) a zároveň SEC-2 (sanitizovat CR/LF v loc reportu stejně jako ve zprávě); SEC-3 uzavřít bez akce jako informační supply-chain poznámku.

## Steps
- [done] Predikát pod root + kontejnment parse hostu
- [done] Filtr fileNames mimo root + hlučný nález + pravdivý důvod
- [done] SEC-2: sanitizace loc v reportu
- [done] Testy se zuby (3, padnou na starém kódu)
- [done] Uzavřít SEC-3 bez kódu + zbytkový vektor 3 doložit
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 17: Zadržení tsc v kořeni projektu

## Discussion
# Phase 17 — Zadržení tsc v kořeni projektu

## Intent
Opravit nálezy z bezpečnostního review `.mini/security/range-12-16.md`:

- **SEC-1 (should-know):** Podvržený `tsconfig.json` v klonovaném cizím repu donutí tsc
  číst soubory MIMO analyzovaný `root`. Tři vektory čtení:
  1. `files`/`include` s `../` nebo absolutní cestou → skončí v `cmd.fileNames`, čte
     `ts.createProgram` (`src/analyze/tsc.ts:84`).
  2. `extends` mimo root → soubor se čte UŽ UVNITŘ `parseJsonConfigFileContent`
     (`tsc.ts:52`), tedy DŘÍV, než lze filtrovat `cmd.fileNames`. Filtr fileNames tenhle
     vektor NEZASTAVÍ — musí se blokovat přes vlastní *parse host* předaný jako 2. argument.
  3. `import` / `/// <reference path="../..">` uvnitř zdrojáků → tahá resolver
     `createProgram`u. **Mimo rozsah této fáze** (viz Key decisions) — zbytkové, zdokumentovat.
  Dopad je omezený (žádný síťový exfil kanál), ale jde o probing FS vývojáře + vtažení
  cizích cest/obsahu do reportu, který může sdílet. Centrální invariant = non-goal č. 1.

- **SEC-2 (nit):** `renderFinding` (`src/report/markdown.ts:105`) čistí `loc` jen na backtick,
  ne na CR/LF. Soubor se jménem obsahujícím newline (na Linuxu legální) rozbije inline
  code-span a vloží do reportu řádek mimo strukturu. Nekonzistence: zpráva se přes
  `sanitizeInline` čistí, cesta ne.

- **SEC-3 (nit):** Jen supply-chain poznámka (eslint 9 + parser, ts do dependencies). Review
  sám říká „žádná akce nutná teď“. UZAVŘÍT BEZ KÓDOVÉ ZMĚNY — jen vědomě potvrdit v reportu fáze.

## Key decisions
- **Hloubka obrany = `files`/`include` + `extends`.** Pokrýt oba vektory, které review
  jmenuje. Vektor `import`/`reference` (potřeboval by vlastní compiler host) je ZBYTKOVÉ
  riziko — pro V1 nechat být a JEN ZDOKUMENTOVAT (v reportu fáze / komentáři), ne řešit.
- **Reakce na odkaz ven = vyfiltrovat + hlučný nález.** Vynechat jen závadné cesty z
  `cmd.fileNames`, zbytek projektu normálně zanalyzovat, a přidat VIDITELNÝ Finding do reportu
  (md i json), aby uživatel pokus VIDĚL. NE skipovat celou tsc vrstvu (jeden řádek tsconfigu
  by zabil celou typovou analýzu = DoS reportu).
- **Monorepo = tvrdě zadržet v root (V1).** I legitimní `extends: "../../tsconfig.base.json"`
  se zařízne/ohlásí. Falešně okleštěná analýza je otravná, ne nebezpečná; monorepo není
  deklarovaný V1 cíl. Žádný parent-walk.
- **SEC-2 oprava = jednořádek:** `const loc = sanitizeInline(formatLocation(f))` místo
  `formatLocation(f).replace(/`/g, "'")`. `sanitizeInline` už dělá `[\r\n]+ → mezera` +
  backtick → `'` + `.trim()`. Konzistentní se zprávou.

## Watch out for
- **NEROZBÍT načítání lib/@types.** Naivní „zakázat čtení mimo root“ by rozbil tsc úplně:
  `lib.es2020.d.ts` a `@types` leží MIMO root (v přibaleném TS / node_modules). Klíč: tyhle
  se tahají až v `createProgram`u přes default host, NE přes parse host a NE přes `cmd.fileNames`.
  → Filtr `fileNames` na „pod root“ je bezpečný (zdrojáky tam patří). Parse host kontejnment
  se libů NEDOTKNE (parse host čte jen tsconfig řetězec extends + enumeruje include dirs).
  createProgram necháme s default hostem (libs/@types se načtou normálně) — proto vektor 3 zbývá.
- **Parse host kontejnment:** vlastní `ParseConfigHost` obalující `ts.sys`
  (`useCaseSensitiveFileNames`, `readDirectory`, `fileExists`, `readFile`); predikát „cesta
  po `path.resolve` leží pod root“ (root sám nebo `root + path.sep` prefix, pozor na
  case-sensitivity a na `..` normalizaci). `readFile`/`fileExists` venku → odmítnout (extends
  pak TS ohlásí jako config chybu = náš Finding). Zvážit kontejnment i `readDirectory`
  (include glob nesmí enumerovat ven) — bezpečnější, ale ověřit, že nerozbije legitimní include.
- **Prázdný výsledek po filtru:** když filtr VYHODÍ VŠECHNY fileNames, existující větev
  `cmd.fileNames.length === 0` (tsc.ts:60) dá důvod „prázdný projekt“ — to by LHALO. Tahle
  cesta musí dát pravdivý důvod / Finding „vše mimo root, vynecháno“, ne „prázdný projekt“.
- **Tvar Findingu pro vynechané cesty:** message-only Finding (bez `file`/`line`) jde —
  `toFinding` to už umí (tsc.ts:155). `source: "tsc"`, severity warning. Musí protéct do md
  i json reportu (ne jen do jednoho).
- **TESTY SE ZUBY (povinné, padnou na STARÉM kódu):**
  - SEC-1 vektor 1: fixtura `tsconfig` s `files: ["../../../../etc/hostname"]` (nebo sentinel
    soubor mimo root) → cesta se NESMÍ objevit ve `fileNames`/findings jako analyzovaná; MÍSTO
    toho hlučný Finding. Na starém kódu by tsc soubor zařadil → test padne = důkaz změny chování.
  - SEC-1 vektor 2 (extends): fixtura s `extends` mířícím na soubor mimo root, který NASTAVUJE
    rozpoznatelný compilerOption → po opravě ten option NESMÍ být v `cmd.options` (důkaz, že se
    extends přes náš host nepřečetl) + ohlášeno. Bez teeth na extends je SEC-1 jen půlka.
  - SEC-2: Finding s `file` obsahujícím `\n` → výstup markdownu nesmí mít víc řádků / rozbitý
    code-span. Na starém kódu (jen `replace(/`/g)`) padne.
- **Self-review:** fáze sahá na chybové cesty + parsování cizího vstupu + kontrakt do reportu
  → před reportem pustit nezávislého sub-agenta (čerstvý kontext) dle projektového CLAUDE.md.
- **Rozsah:** střední. SEC-2 je triviál; SEC-1 parse-host kontejnment + filtr + Finding +
  3 testy se zuby je jádro. Nehromadit (vektor 3, monorepo parent-walk = mimo).

## Run report
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
