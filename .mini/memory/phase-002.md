# Phase 2 — Zpevnění kostry CLI (nálezy 1-1 až 1-3)

**Goal:** Opravit tři should-know nálezy z fáze 1: (1-1) výstupní adresář vytvořený uvnitř scanovaného stromu se nesmí započítat do indexu; (1-2) Dirent s neznámým typem (DT_UNKNOWN) se nesmí tiše zahodit, ale zaznamenat do skippedUnreadable; (1-3) při selhání zápisu MD nesmí na disku zůstat osiřelý JSON (uklidit částečný výstup). Nity 1-4 až 1-6 jsou mimo tuto fázi.

## Steps
- [done] scanTree: vyloučit výstupní adresář podle cesty
- [done] scanTree: nezahazovat neznámé/zvláštní Dirent typy
- [done] cli: úklid částečného výstupu při selhání zápisu
- [done] Ověření: build, testy, unhappy paths

## Auto-commit
- Phase 2: Zpevnění kostry CLI (nálezy 1-1 až 1-3)

## Run report
---
phase: 2
verdict: done
steps:
  - title: "scanTree: vyloučit výstupní adresář podle cesty"
    status: done
  - title: "scanTree: nezahazovat neznámé/zvláštní Dirent typy"
    status: done
  - title: "cli: úklid částečného výstupu při selhání zápisu"
    status: done
  - title: "Ověření: build, testy, unhappy paths"
    status: done
---

# Phase 2 — report z auto session

Opraveny tři should-know nálezy z fáze 1. Build (`tsc --noEmit`) i testy (`vitest run`, 26 testů) zelené.

## Co se udělalo

**1-1 — výstupní adresář se nezapočítá do indexu**
`ScanOptions` má nově `excludePaths` (set absolutních cest). `walk` u složky, jejíž
absolutní cesta padne do `excludePaths`, neudělá push ani rekurzi → vynechá se i celý
podstrom. `cli.ts` předá `new Set([outDir])`. Protože `targetPath` i `outDir` jsou už
absolutní (`path.resolve` v `args.ts`), porovnání cest je přímé.
Ověřeno reálným CLI: běh s `--out <proj>/report` → v indexu jen `README.md`, `src`,
`src/index.ts`; `report` chybí.

**1-2 — neznámé/zvláštní Dirent typy se nezahodí tiše**
Smyčka ve `scan.ts` už nepropadá. Když `ent` není symlink/dir/file (DT_UNKNOWN na FS
bez `d_type`, nebo fifo/socket/device), dořeší se přes `lstat` (ne `stat`, ať se ani tady
nesleduje symlink): skutečný soubor/složka se zaindexuje normálně, jinak (fifo/socket/
device nebo selhání `lstat`) jde záznam do `skippedUnreadable`. Test s `mkfifo`: fifo
`pipe` se objeví v `skippedUnreadable`, ne mezi `files`.

**1-3 — žádný osiřelý JSON při selhání zápisu MD**
Logiku zápisu jsem vytáhl do `src/report/writeOutputs.ts` (`writeReportFiles`) – kvůli
testovatelnosti přesně té chybové cesty (název souboru závisí na timestampu, takže přes
neexportovaný `run()` v CLI ji nešlo deterministicky vynutit). Funkce zapíše JSON, pak MD;
při jakékoli chybě best-effort smaže OBĚ cesty a chybu propaguje dál. `cli.ts` ji volá a
chybu přeloží na hlášku + exit 1.

## Adversariální review fáze 2 – blocker, který jsem si sám vyrobil (opraveno)

První verze 1-3 byla CHYBNÁ a adversariální review to právem označil jako blocker (2-1):

- **2-1 (blocker):** Měl jsem pole `written`, do kterého se cesta přidala AŽ po `await
  writeFile`. Jenže `writeFile` otevírá s O_CREAT|O_TRUNC – soubor vznikne už při open.
  Když write selže až potom (plný disk ENOSPC, kvóta, EFBIG, EIO – právě ten realistický
  důvod, proč by druhý zápis selhal), soubor na disku JE, ale do `written` se nedostane →
  `catch` ho neuklidil. Cíl 1-3 tím pro reálný spouštěč neplatil. **Oprava:** v `catch`
  bezpodmínečně `unlink(jsonPath).catch()` i `unlink(mdPath).catch()`. Jednodušší i
  správnější než pole `written`.
- **2-2 (should-know):** Můj jediný chybový test používal EISDIR, který selže UŽ při open
  → žádný soubor nevznikne → osiřelý výstup se nemohl objevit. Falešná jistota. **Oprava:**
  přidán deterministický test, který mockem `writeFile` soubor reálně vytvoří a pak
  rejectne (ENOSPC/EFBIG) – ověří, že úklid smaže i orphan vzniklý po open. (Tyto testy
  ověřeně padaly proti staré verzi.)
- **2-3 (should-know):** fifo test se bez `mkfifo` přes `try/return` tiše „prošel" bez
  assertion. **Oprava:** `it.skipIf(!hasMkfifo)` – buď viditelně skipnutý, nebo běží
  s reálnými assertions (žádné spolknuté selhání).
- **2-4 (nit):** doc komentář sliboval návratovou hodnotu, funkce vrací void. **Oprava:**
  komentář přepsán, končí „Vrací `void`".

## Druhé kolo adversariální review (2-5 až 2-8)

- **2-5 (should-know): OPRAVENO.** Vyloučení outDir bylo holé porovnání řetězců;
  `path.resolve` nerozbaluje symlinky, takže `--out` přes symlink by se nevyloučil a
  výstupní adresář by se indexoval (a rostl každým během) – tichá díra přesně v cíli 1-1.
  Fix v `scan.ts`: kanonizace přes `realpath` na obou koncích (kořen i `excludePaths`),
  walk staví abs od kanonického kořene. Test: outDir zadaný symlinkovým zápisem se vyloučí.
- **2-6 (should-know): OPRAVENO (test).** Recovery větev 1-2 (DT_UNKNOWN → dořeš přes lstat
  a ZAINDEXUJ skutečný soubor) neměla test. Doplněn mock-test: `readdir` vrátí Dirent bez
  typu, reálný soubor na disku → ověří, že se zaindexuje (ne hodí do skippedUnreadable).
- **2-7 (nit): NEOPRAVENO – záměrně.** Úklid maže obě cesty bezpodmínečně, ne „co jsem
  vytvořil". Riziko (smazání cizího souboru na té cestě) je ohraničené unikátností názvu
  s ms-razítkem → reálně nastane jen při kolizi razítka, což je samostatný otevřený nit
  **1-5**. „Správné" rozlišení created-by-us vs. pre-existing nejde spolehlivě udělat (právě
  ta open-před-write realita, co stála za 2-1). Fix v izolaci přidá složitost pro
  skoro-nemožný případ; rozumné je řešit až spolu s 1-5 (unikátnost názvu).
- **2-8 (nit): OPRAVENO.** Větev zvláštních typů (lstat fallback → fifo/socket/device →
  skippedUnreadable) měla assertions jen přes mkfifo (na CI bez něj nula pokrytí). Doplněn
  portovatelný mock-test (readdir + lstat), který tu větev ověří nezávisle na platformě;
  mkfifo test zůstává jako reálná integrační kontrola (it.skipIf).

## Třetí kolo adversariální review (2-9 až 2-11)

- **2-9 (should-know): OPRAVENO.** Napojení cli→scanTree(excludePaths) – jádro cíle 1-1 –
  nemělo automatický test (run() nebyl exportovaný). Smazání jednoho řádku by prošlo zeleně
  a regresoval by celý smysl fáze. Fix: `run` exportovaná s parametrizovatelným `argv`/`cwd`,
  auto-spuštění dole ohlídané `isMain` (import v testu nespustí run proti argv test-runneru).
  Nový `cli.test.ts`: běh s `--out` uvnitř stromu → výstupní adresář není v JSON indexu.
- **2-10 (should-know): OPRAVENO (test).** Bezpečnostní guard `if (st.isSymbolicLink())
  continue` ve větvi DT_UNKNOWN byl netestovaný (symlink přes DT_UNKNOWN scénář). Doplněn
  mock-test: readdir vrátí netypovaný Dirent, lstat vrátí symlink → ověří, že se tiše
  přeskočí (ani index, ani skippedUnreadable). Bez guardu by skončil v skippedUnreadable.
- **2-11 (nit): NEOPRAVENO – záměrně.** Dvojí stat (lstat kvůli typu + stat kvůli velikosti)
  u DT_UNKNOWN souborů. Týká se jen FS bez d_type (vzácné) → opravdu nit. „Úspora" by znamenala
  protáhnout velikost z lstatu zvláštní cestou jen pro tuhle větev = víc větvení pro vzácný
  případ. Nepřináší to teď hodnotu úměrnou riziku; necháno být.

## Čtvrté kolo adversariální review (2-12 až 2-13) – další blocker, který jsem si vyrobil

- **2-12 (blocker): OPRAVENO.** Můj `isMain` guard z fixu 2-9 rozbil produkční vstupní bod.
  `path.resolve(argv[1])` nerozbaluje symlink, ale `import.meta.url` node u main modulu
  dereferencuje na realpath. npm `bin` instaluje symlink na dist/cli.js → `argv[1]` = symlink,
  url = realpath → nerovnost → `run()` se NIKDY nezavolal → po instalaci tichý no-op (exit 0,
  vypadá jako úspěch). Empiricky ověřeno: `node dist/cli.js --help` vypíše help, `node
  <symlink> --help` nevypsal NIC. Fix: `isEntrypoint()` realpathuje OBĚ strany (+ try/catch).
  Po fixu symlink vypíše help.
- **2-13 (should-know): OPRAVENO.** Auto-spuštění (`isMain && run()`) nemělo pokrytí –
  `cli.test.ts` importuje `run()` přímo, takže blocker 2-12 prošel zeleně. Falešná jistota
  přesně tam, kde guard vznikl kvůli testovatelnosti. Dvě vrstvy testů: (a) deterministický
  unit test `isEntrypoint` se symlink fixturou (rychlý, pojistka logiky); (b) reálný spawn
  test (`cli.entrypoint.test.ts`): build → symlink na dist/cli.js → `node <symlink> --help`
  → ověří neprázdný výstup. Ten jediný chytí tichý no-op (musí běžet jako main modul).

## Páté kolo adversariální review (2-14)

- **2-14 (should-know): OPRAVENO (test).** Větev DT_UNKNOWN → lstat → adresář → rekurze
  neměla test (pokryty byly jen →soubor, →zvláštní typ, →symlink). Přitom na FS bez d_type
  (overlayfs/Docker, NFS, FUSE – přesně prostředí, kvůli kterému 1-2 vzniklo) jde KAŽDÝ
  adresář touhle cestou; regrese = tiché zahození podstromů. Doplněn path-aware mock-test:
  reálná struktura na disku, readdir ji vrátí jako typeless → vše projde lstat fallbackem,
  ověří se zaindexování adresáře I rekurzivní průchod do souboru uvnitř. Past se zacyklením
  (globální spy vrací stejný entry) obejita delegací na reálný readdir (konečná struktura).

## Rozhodnutí ke zvážení (`/mini:decision` před `/mini:done`)

Zvažoval jsem **atomicitu přes temp + dva renamy** a **zavrhl** ji: druhý rename (MD) může
selhat stejně jako přímý zápis, takže dvousouborovou atomicitu reálně nedává — jen přidá
složitost. Místo toho best-effort úklid. Toto je trvalá volba, kterou z kódu později
nepoznáš → stojí za ADR.

## Poctivá omezení (nezakrývám)

- **Úklid 1-3 je best-effort, ne záruka.** Když selže i `unlink` (právě odebraná práva na
  adresář), osiřelý soubor zůstane. Hláška to přiznává slovem „best-effort", neslibuje 100 %.
- **1-2 `lstat` fallback** přidá `lstat` jen pro entries, které readdir neoznačí typem
  (DT_UNKNOWN / zvláštní typy). Běžná cesta s populovaným `d_type` extra syscall nedělá.
- **E2E ověření 1-3** přes reálné CLI trefilo větev „selže hned první (JSON) zápis"
  (read-only outDir → exit 1, prázdný adresář). Větev „soubor vznikl při open, write selhal"
  (ENOSPC/EFBIG) pokrývají deterministické unit testy ve `writeOutputs.test.ts` mockem
  `writeFile` (NE EISDIR – ten selže už při open a orphan nevyrobí; to byla původní chyba).
- **Test 1-3 závisí na mocku `node:fs/promises`** (vi.mock passthrough + spyOn). Mockuje se
  jen `writeFile`, zbytek volá reálnou implementaci; spouštěč ENOSPC/EFBIG je simulovaný,
  ne vyvolaný reálným plným diskem. `ulimit -f 0` jsem zkoušel pro reálnou reprodukci, ale
  zabíjí i `tsx` (taky zapisuje) – proto mock.

## Mimo rozsah
Nity 1-4, 1-5, 1-6 záměrně neřešeny (patří do pozdější fáze).
