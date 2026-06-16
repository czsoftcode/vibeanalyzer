---
phase: 3
verdict: done
steps:
  - title: "Test: neplatný cíl → exit 1"
    status: done
  - title: "Test: selhání mkdir → exit 1"
    status: done
  - title: "Test: selhání zápisu → exit 1"
    status: done
  - title: "Oprava isEntrypoint – fail-closed s rozlišeným fallbackem"
    status: done
  - title: "Test: isEntrypoint na vyhozené výjimce"
    status: done
  - title: "Spustit celou sadu + typecheck"
    status: done
---

# Phase 3 — report z auto session

## Co se udělalo
- **Detekce vstupního bodu (2-17 a celá řada 3-1/3-2/3-4) – KOŘENOVÁ OPRAVA.** Postup byl iterativní a poučný: nit 2-17 jsem nejdřív „opravil" tím, že realpath modulu házel nahlas → 3-1 (pád při importu) → oprava na `false`+varování → 3-4 (slévání „nejsem entry" a „nelze určit" → exit 0 = falešný úspěch, doslova zpátky u 2-12). Každá záplata symptom jen přestěhovala. Po dohodě s uživatelem **zrušena celá detekce**: `isEntrypoint` i top-level spouštěcí blok z `cli.ts` pryč; vznikl dedikovaný `src/bin.ts` (`#!/usr/bin/env node`, jen zavolá `run()`), `package.json bin → dist/bin.js` (+ `dev`/`start` skripty). `cli.ts` je teď čistá knihovna bez vedlejšího efektu. Když node spouští dedikovaný bin, není co detekovat → třída chyb 2-12/2-17/3-1/3-2/3-4 zaniká celá.
- **Testy chybových větví `run()` (2-15)** v `src/cli.test.ts` (nový blok „run – chybové větve"):
  - neplatný cíl (neexistující cesta) → exit 1 + hláška „Cesta neexistuje" (bez mocku, reálné),
  - selhání mkdir vynucené přes ENOTDIR (`--out` míří dovnitř existujícího souboru) → exit 1 + hláška „výstupní adresář nelze vytvořit" včetně kódu ENOTDIR (bez mocku, reálné).
- **Test selhání zápisu (2-15)** v novém souboru `src/cli.writefail.test.ts`: `vi.mock` na `./report/writeOutputs.js` nechá `writeReportFiles` vyhodit ErrnoException → `run()` chytí, vrátí 1, vypíše „výstup nelze zapsat" + ENOSPC. Záměrně samostatný soubor – `vi.mock` se hoistuje na celý modul a globální mock by rozbil integrační test v `cli.test.ts`, který spoléhá na reálný zápis.
- **Krok „Test: isEntrypoint na vyhozené výjimce" je tím překonaný** – `isEntrypoint` přestal existovat, takže jeho jednotkové testy jsem smazal. Záruku „CLI se po instalaci přes symlink opravdu spustí" teď drží reálný integrační test `cli.entrypoint.test.ts`, přesměrovaný na `dist/bin.js`. To je silnější důkaz než bývalý in-process test.

## Ověření
- `npm run typecheck` čistý.
- `npm test` zelené: 8 souborů, 49 testů (postupně doplňováno přes nálezy 3-3 až 3-15: entrypoint, launcher, scan/build, scan unit, orphan-dir asserty, úklid cizího/zanořeného adresáře; −5 testů zrušeného `isEntrypoint`).
- **Reálné spuštění `dist/bin.js`** (po `npm run build`): `--help` vypíše nápovědu; běh na složce vrátí exit 0 a zapíše JSON+MD report; neplatný cíl vrátí exit 1 s „Cesta neexistuje". Symlink integrační test běží proti reálnému `dist/bin.js` a prochází.

## Adversariální review (3-1 až 3-15) a reakce
- **3-1, 3-2, 3-4** – všechny tři pocházely z detekce vstupního bodu. Vyřešeny **odstraněním celé detekce** (viz kořenová oprava výše), ne další záplatou. V `.mini/findings/` zůstávají formálně `open` (mini nemá CLI na `resolve`), ale v kódu už nemají kde vzniknout.
- **3-5 (should-know) – vyřešeno.** Starý entrypoint test spouštěl `node <symlink>`, čímž obešel shebang i execute bit a neověřil reálný npm-bin mechanismus (npm volá binárku jménem). Doplněn test, který symlink spouští **přímo** (`execFileSync(link, …)`) po `chmod +x` (simulace npm bin-links), plus test korektního shebangu. Adversariálně ověřeno, že bez `+x` přímé spuštění padá (exit 126), takže test má zuby. Starý `node <link>` test ponechán jako izolace „modul běží pod node".
- **3-3 (nit) – vyřešeno, a po cestě odhalena vážnější věc.** Literální nález (obalit `scanTree → build*` do `try/catch`) jsem splnil – cílená hláška „analýzu se nepodařilo dokončit" + exit 1. ALE při zkoumání se ukázalo, že `scanTree` je sám defenzivní a na zmizelý cíl **nehodí** – vrátí 0 souborů a `skippedUnreadable: ["."]`. Reálný TOCTOU tedy nevedl k výjimce, ale k **tichému reportu o 0 souborech a exit 0** (falešný úspěch, třída z 3-4), což obalení nechytí. Po dohodě s uživatelem proto přidán i guard: když `skippedUnreadable` obsahuje `"."` (kořen nepřečten), `run()` vrátí exit 1 s hláškou „cílovou složku nelze přečíst". Rozlišení je přesné – legitimně prázdná čitelná složka `"."` v seznamu nemá (ověřeno reálným během: prázdná složka → exit 0). Testy v novém `cli.scanfail.test.ts` (mock `./scan.js`): výjimka → exit 1; nečitelný kořen → exit 1; prázdná složka → exit 0.
- **3-6 (nit) – vyřešeno.** Doplněn nový `describe` v `cli.entrypoint.test.ts`: spustí **reálný zkopírovaný `dist/bin.js`** vedle podvržené `./cli.js` (kterou si bin.js natáhne relativním importem) a ověří tři věci – `run()` hodí → exit 1 + „Neočekávaná chyba" na stderr; `run()` vrátí 3 → exit 3; vrátí 0 → exit 0. `run()` ani `scanTree` nejdou z reálného vstupu deterministicky shodit (chytají si chyby), proto izolace přes podvržené `cli.js`, ne přes reálný běh. Adversariálně ověřeno, že test má zuby: bez `.catch` v launcheru Node sice taky skončí exit 1 (neošetřený reject), ale stderr neobsahuje „Neočekávaná chyba" → aserce na ten text rozbití chytí (samotná aserce na exit kód by nestačila).
- **3-7 (should-know) – vyřešeno (mířilo do mé opravy 3-3).** `try/catch` z 3-3 obaloval i `buildJsonIndex`/`buildMarkdown` (čistě in-memory) → programová chyba v nich by se maskovala jako I/O selhání a ztratil by se stack. Zúženo na „jen `scanTree`" – ale to byl jen mezikrok: následný nález 3-11 ukázal, že i ten catch kolem scanTree byl stejný anti-vzor, takže byl nakonec **odstraněn úplně** (viz 3-11). `build*` i `scanTree` teď probublají do launcher catche v `bin.ts` s plným stackem (pokryto testem 3-6).
- **3-8 (should-know) – vyřešeno.** Kontrakt magického `"."` mezi `scan.ts` a guardem v `cli.ts` byl jen na holém literálu a žádný test neověřoval, že `scanTree` pro nečitelný **kořen** ten marker reálně emituje (mock ho měl natvrdo, `scan.test` testoval jen podadresář). Zavedena sdílená konstanta `ROOT_UNREADABLE_MARKER` (export ze `scan.ts`, importují ji `cli.ts` i oba testy) + reálný unit test ve `scan.test.ts`: `scanTree` na nečitelný/zmizelý kořen → `skippedUnreadable` obsahuje marker. Adversariálně ověřeno: po rozbití `scan.ts` (push rel místo markeru) ten test padá → má zuby.
- **3-9 (nit) – vyřešeno.** `mkdir(outDir)` přesunut až těsně před zápis (po scanu i guardu), takže dřívější selhání (neprojitelný/nečitelný cíl) po sobě nenechá osiřelý prázdný výstupní adresář. Ověřeno reálně: neplatný cíl → outDir nevznikne; happy path píše dál. Kompromis: chybu nevytvořitelného outDir nahlásíme až po scanu, ne hned (scan je levný, běžný případ projde) – hlídá to dosavadní mkdir test.
- **3-10 (should-know) – vyřešeno.** 3-9 neřešilo write-failure větev: `mkdir` adresář vytvoří, `writeReportFiles` selže, uklidí jen soubory → prázdný `outDir` zůstal a hláška „částečný výstup jsem se pokusil uklidit" vůči adresáři lhala. Přidán úklid adresáře ve write-catchi + hláška opravena na pravdivou. (POZN.: první verze používala `rmdir(outDir)` spoléhající na ENOTEMPTY; následné nálezy 3-14/3-15 ukázaly, že to maže cizí prázdný adresář a nechává zanořené rodiče – zpřesněno na `rm(createdDir)` dle návratu `mkdir`, viz 3-14/3-15.)
- **3-11 (should-know) – vyřešeno, mířilo do mé opravy 3-3/3-7.** `try/catch` kolem `scanTree` byl k ničemu: scanTree na I/O nikdy nehodí (vše má interní catch / `.catch`), takže catch chytal jen programovou chybu a maskoval ji jako „I/O selhání" bez stacku – přesně anti-vzor, kvůli kterému jsem v 3-7 vyndal `build*`. Stejnou úvahu jsem na scanTree zapomněl aplikovat (porušení bodu 2 mého checklistu). Catch kolem scanTree **úplně odstraněn**: programová chyba teď probublá se stackem do launcher catche v `bin.ts`. Reálný TOCTOU řeší guard (marker), ne výjimka. Pin testem: `run()` při výjimce ze scanTree rejectne (re-přidání catche test chytí).
- **3-12 (nit) – vyřešeno.** Záruka 3-9 (outDir při selhání scanu/guardu nevznikne) byla ověřená jen ručně. Doplněny asserty: guard větev → `access(outDir)` hodí ENOENT; happy path → outDir existuje (kontrast). Regrese pořadí (mkdir zpět nad guard) teď padne.
- **3-13 (nit) – vyřešeno.** Test „scanTree hodí (EIO)" cílil na z reálného vstupu nedosažitelnou větev (viz 3-11) → falešná jistota o TOCTOU pokrytí. Přepsán tak, aby pinoval rozhodnutí 3-11 (výjimka ze scanTree se PROPAGUJE, nemaskuje), ne aby předstíral pokrytí I/O TOCTOU.
- **3-14 (should-know) + 3-15 (nit) – vyřešeno společně (oba z mé opravy 3-10).** Můj úklid 3-10 volal `rmdir(outDir)` bezpodmínečně. 3-14: když uživatel předá vlastní PRÁZDNÝ adresář jako `--out` a zápis selže, smazal bych mu ho (mkdir na existující dir je no-op, návrat se ignoroval). 3-15: u zanořeného `--out` (`a/b/report`) `rmdir` smazal jen list, prázdné `a`/`b` zůstaly. Společná příčina = ignorovaná návratová hodnota `mkdir`. Oprava: `createdDir = await mkdir(outDir, {recursive:true})` (vrací nejvyšší vytvořenou cestu nebo `undefined`); při selhání zápisu `rm(createdDir, {recursive:true})` jen když `createdDir !== undefined`. Tím mažeme přesně to, co jsme vytvořili (včetně mezičlánků), a nic cizího/staršího. Testy: cizí prázdný adresář přežije; zanořené mezičlánky se uklidí; (původní) outDir vytvořený během zmizí; neprázdný existující zůstane.

## Poctivé upozornění (trade-offy / co testy NEhlídají)
- **Sebekritika:** první tři varianty opravy detekce vstupního bodu byly špatně – honil jsem nit a pětkrát přestěhoval ten samý symptom (falešný úspěch / pád / falešné selhání). Správné řešení bylo zrušit základ, ne ho látat. Stálo to čtyři kola adversariálního review, než to bylo vidět.
- Test selhání zápisu testuje **seam** `writeReportFiles` (mock), ne reálné selhání FS. Ověří větev `catch` v `run()` a tvar hlášky, ne že skutečné `writeFile` selže právě takhle. Vědomý kompromis – pod rootem na Linuxu se práva (chmod) obejdou.
- Testy chybových větví `run()` (neplatný cíl, mkdir) doplňují pokrytí dle 2-15; ty větve exit 1 vracely už dřív, takže to nejsou pasti na budoucí regresi logiky, jen ověření návratových kódů a hlášek.
- 3-7 jen zúžil záběr catche – `build*` výjimka teď nemá v `run()` cílený test (probublá do launcheru, pokryto 3-6 testem genericky). To je vědomé: cílit hlášku na programovou chybu by ji zase maskovalo.
- `.mini/graph.json` je vhodné po těchto změnách znovu přegenerovat přes `/mini:map` (změnil se `scan.ts`, `cli.ts`, `scan.test.ts`).
- Všechny nálezy fáze 3 (3-1 až 3-15) jsou adresované v kódu; v `.mini/findings/` zůstávají formálně `open` (mini nemá CLI na `resolve`).
- Vzorec série: 3-7, 3-10, 3-11, 3-12, 3-13, 3-14, 3-15 byly všechny důsledkem mých vlastních oprav předchozích nálezů (moc široký catch, nedotažený úklid, magický literál, ignorovaný návrat mkdir). Konkrétně úklid výstupního adresáře jsem opravoval třikrát (3-10 → 3-14/3-15) – pořád dokola bod 5 checklistu (vedlejší efekty při selhání). To je silný signál, že u chybových cest v `cli.ts` ten checklist + nezávislý sub-agent NEpustit až po reviewu, ale hned při psaní.

## Otevřené otázky
- Žádné blokery. Nález 2-16 je mimo tuto fázi (řeší se zvlášť), nedotčen.
