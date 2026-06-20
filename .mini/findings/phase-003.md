# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 3-1 · should-know · resolved
**Where:** src/cli.ts:129,143
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** isEntrypoint odstraněn: bin.ts je dedikovaný spustitelný vstup, runCli (cliMain.ts) volá run() bezpodmínečně. Žádná realpath detekce při evaluaci modulu → crash při importu v exotickém runtime odpadá. cli.ts:47 SELF_PATH slouží jen pro CHILD_PATH, ne pro detekci entrypointu.
isEntrypoint může házet při importu modulu – volání na řádku 143 to nechytá

Fáze úmyslně vytáhla 'realpathSync(fileURLToPath(moduleUrl))' MIMO try/catch (ř. 129), aby rozbitý moduleUrl padl nahlas. Jenže isEntrypoint() se volá nepodmíněně na top-levelu modulu (ř. 143) a tamní '.catch' obaluje JEN promise z run(), ne samotné isEntrypoint. Důsledek: pokud import.meta.url není rozbalitelný na existující soubor (data:/node: URL u bundleru, nebo SEA/pkg/nexe virtuální FS, kde soubor reálně neexistuje), pouhý 'import { run } from "./cli.js"' nebo spuštění bundlu shodí proces NEZACHYCENOU výjimkou při evaluaci modulu – ne čistým 'Neočekávaná chyba … exit 1' handlerem. Stará verze to spolkla do 'false' → import byl vždy bezpečný (no-op). Regrese je v reportu zdůvodněná jen jako fail-closed exit kód, blast-radius (crash při importu / v exotickém runtime) není zmíněn. Normální npm ESM distribuce (file: URL, existující dist/cli.js) zasažená není – proto should-know, ne blocker. Konzistentní fix: obalit volání isEntrypoint na ř. 143 stejným catch jako run().

## 3-2 · nit · resolved
**Where:** src/cli.ts:134-139
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** isEntrypoint celý odstraněn (i s nedosažitelným fallbackem); bin.ts je dedikovaný vstup bez jakékoli detekce. Sporný kód už neexistuje.
Fallback v isEntrypoint je v praxi téměř nedosažitelný, komentář mate

Catch větev vrací 'resolvedEntry === moduleRealPath', kde resolvedEntry je jen path.resolve(argv[1]) (bez realpathu) a moduleRealPath je realpath modulu. Aby tahle větev vrátila true, musel by být resolvedEntry roven existující realpath cestě modulu, ALE realpathSync(resolvedEntry) přitom hodit. Jenže když se resolvedEntry rovná existující cestě, realpathSync(resolvedEntry) uspěje → rozhodnutí padne už v try větvi, ne ve fallbacku. Fallback tak true vrátí prakticky jen při TOCTOU závodu (soubor smazán mezi dvěma realpath voláními) nebo vzácném EACCES uprostřed resoluce. Komentář tvrdí, že 'nezahodí případnou shodu, kdy argv[1] už je realpath modulu' – jenže přesně tu shodu řeší už try větev. Je to extra větev + odůvodnění pro cestu, která skoro vždy vrací false. Premature complexity; funkčně neškodí (fail-closed), proto nit.

## 3-3 · nit · resolved
**Where:** src/cli.ts:76-84
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Úsek scanTree→build už NENÍ v try/catch (cli.ts:194 komentář, build na 386-398 mimo blok). TOCTOU řeší defenzivní scanTree → ROOT_UNREADABLE_MARKER → guard cli.ts:232 s CÍLENOU hláškou 'cílovou složku nelze přečíst', ne generickou. Programová chyba probublá se stackem do bin.ts. Nekonzistence pryč.
scanTree/buildJsonIndex/buildMarkdown nejsou v run() obaleny – TOCTOU dá generickou hlášku

Fáze zpevnila tři chybové cesty (validateTarget, mkdir, writeReportFiles), ale úsek scanTree() → buildJsonIndex() → buildMarkdown() (ř. 76-84) mezi validací a zápisem zůstal bez try/catch. Když je cíl smazán/odebrána práva PO validateTarget (TOCTOU), nebo scanTree narazí na neočekávanou chybu, run() rejectne a uživatel dostane generické 'Neočekávaná chyba: …' z top-level catch (ř. 148), ne cílenou hlášku jako u ostatních cest. Exit kód je správně 1 a proces nespadne tiše, takže funkčně OK – proto nit; jen je to nekonzistentní s cílem fáze 'zpevnit chybové cesty' (jedna cesta hlásí jinak/hůř než zbytek).

## 3-4 · should-know · resolved
**Where:** src/cli.ts:128-136,147-156
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** isEntrypoint odstraněn; runCli (cliMain.ts:40-56) vrací při chybě exit 1, bin.ts:26-35 ho přiřadí do process.exitCode. Žádná detekce → žádné slévání 'nejsem' vs 'nevím' → žádný tichý exit 0. Zuby: cliMain.test.ts:53-69 a 71-92.
isEntrypoint slévá 'nejsem entrypoint' a 'nelze určit' do false → tichý exit 0 jako falešný úspěch

Oprava 3-1 (správně) přestala házet: když realpath modulu selže, vrátí isEntrypoint false. Jenže volající na ř. 147 nerozlišuje 'false = nejsem vstupní bod' od 'false = nedokázal jsem to určit'. Při skutečném vstupním bodu v exotickém runtime (SEA/pkg/nexe, virtuální FS, kde realpath(import.meta.url) hodí) se tedy run() NEZAVOLÁ, process.exitCode zůstane nenastavený → proces skončí EXIT 0. Na stderr sice probliklo varování, ale wrapper/CI skript kontrolující $? uvidí 0 = úspěch, přitom CLI neudělalo nic a nezapsalo žádný report. To je horší selhání než pád 3-1 (loud) – falešný úspěch je tichý. Report trade-off zmiňuje 'CLI no-opne s varováním', ale konkrétně exit kód 0 (= úspěch) nepojmenovává. Reálná dosažitelnost je nízká: shipuje se jako npm ESM (file: URL, realpath projde), takže latentní/obranná věc – proto should-know, ne blocker. Možný směr: rozlišit dvě false (např. caller dostane signál 'undetermined' a nastaví nenulový exit), nebo to vědomě přijmout a doplnit do trade-offů, že no-op = exit 0.

## 3-5 · should-know · resolved
**Where:** src/cli.entrypoint.test.ts:32
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** cli.entrypoint.test.ts nově ověřuje shebang (ř.40-43) i PŘÍMÉ spuštění symlinku po chmod +x (execFileSync(link), ř.51-55) – reálný npm-bin mechanismus (shebang + execute bit), ne jen 'node <symlink>'. Má zuby.
Entrypoint test spouští 'node <symlink>', ne binárku přímo – neověří shebang ani +x

Test je v reportu označen jako 'jediný strážce', že se CLI po instalaci opravdu spustí. Jenže spouští 'execFileSync("node", [link, "--help"])' – tedy node + cesta. Tak ale npm nainstalovanou binárku NESPOUŠTÍ: npm ji volá JMÉNEM a spoléhá na (1) shebang '#!/usr/bin/env node' a (2) execute bit. Reálně ověřeno: dist/bin.js má mód -rw-rw-r-- (bez +x); přímé spuštění symlinku ('/tmp/link --help') padá 'Operace zamítnuta', zatímco 'node /tmp/link --help' projde. Důsledek: test by prošel i s rozbitým/chybějícím shebangem nebo bez +x. +x na binárku přidává až 'npm install' (bin-links chmod) – je load-bearing, ale v repu nijak netestovaný. Tvrzení 'silnější důkaz než in-process test' je tedy přehnané: dokazuje jen, že se modul spustí pod node, ne že funguje npm-bin mechanismus. Fix: spouštět symlink přímo 'execFileSync(link, ["--help"])' (po npm-link nebo s ručním chmod +x), jinak strážce nehlídá to, co tvrdí.

## 3-6 · nit · resolved
**Where:** src/bin.ts:13-16
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Logika pád→exit 1 přesunuta z bin.ts do runCli (cliMain.ts) a otestována se zuby: cliMain.test.ts:53-69 (run hodí → exit 1 + onUnexpected) a cli.entrypoint.test.ts:99-106 (reálný dist/bin.js + podvržená házející cli.js → exit 1 + 'Neočekávaná chyba').
Procesní catch v bin.ts (crash → exit 1) je bez testu

Fáze přidala 3 testy na VNITŘNÍ catche v run() (validateTarget, mkdir, writeReportFiles), ale samotný procesní launcher bin.ts – který nezachycenou výjimku z run() převede na 'Neočekávaná chyba' + process.exitCode=1 – nemá žádný test. Jediný test dotýkající se bin.ts (cli.entrypoint.test.ts) volá jen '--help' (happy path). Přitom právě přes tenhle catch teče neobalený úsek scanTree→buildJsonIndex→buildMarkdown (nález 3-3, TOCTOU), takže odolnost vůči neočekávané chybě stojí celá na něm. Kód je triviální (8 řádků) a vizuálně správný (exitCode se nastaví), riziko regrese nízké – proto nit. Ale ironie: nález 3-4 označil 'exit 0 = falešný úspěch' za nejhorší třídu selhání, a převodník 'pád → exit 1' je teď bez pokrytí. Možný směr: test, který přes bin (child process) vyvolá výjimku v run() a ověří nenulový exit + hlášku.

## 3-7 · should-know · resolved
**Where:** src/cli.ts:77-95
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** buildJsonIndex/buildMarkdown už NEjsou v try/catch (cli.ts:386-398 mimo blok). Programové chyby probublají se stackem do bin.ts 'Neočekávaná chyba', nemaskují se jako I/O selhání.
scan→build try/catch maskuje programové chyby jako I/O selhání a zahazuje stack

Try blok obaluje nejen scanTree (kde TOCTOU dává smysl), ale i buildJsonIndex a buildMarkdown – čistě in-memory výpočty bez I/O. Když v nich vznikne programová chyba (např. TypeError v buildMarkdown), catch ji přetypuje na NodeJS.ErrnoException a vypíše 'analýzu se nepodařilo dokončit: <path> (neznámá chyba): <message>' + exit 1. Konkrétní vstup: jakákoli regrese v buildMarkdown/buildJsonIndex, která hodí ne-Errno chybu. Důsledek: skutečný bug se zamaskuje jako I/O/scan selhání, ztratí se stack (tiskne se jen code+message), a debugging je zbytečně ztížený. Záběr catche je širší než jeho zdůvodnění (TOCTOU se týká jen scanTree). Doporučení: obalit jen scanTree, build nechat probublat do launcher catche v bin.ts, kde se aspoň vypíše 'Neočekávaná chyba' s celým objektem.

## 3-8 · should-know · resolved
**Where:** src/cli.ts:102 ↔ src/scan.ts:74
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Magický literál '.' nahrazen sdílenou konstantou ROOT_UNREADABLE_MARKER (scan.ts:72 export), importovanou v cli.ts:22 a použitou v guardu cli.ts:232 i ve scan.ts:155. scan.test.ts:269-274 reálně ověřuje, že scanTree pro nečitelný kořen emituje ROOT_UNREADABLE_MARKER (přes konstantu, ne literál); cli.scanfail.test.ts:17,63 také váže na konstantu. Přesně doporučený fix nálezu.
Kontrakt magického řetězce '.' mezi scan.ts a guardem v cli.ts je ověřen jen natvrdo zadaným mockem

Guard 'cílovou složku nelze přečíst' stojí na tom, že scanTree při nečitelném KOŘENI vloží do skippedUnreadable přesně '.' (scan.ts:74: relDir === "" ? "." : relDir). Tahle vazba je holý řetězcový literál sdílený dvěma moduly bez společné konstanty. Testy ji ale nikde reálně nepřipínají: cli.scanfail.test.ts:51 mock vrací natvrdo skippedUnreadable:['.'], scan.test.ts:240 testuje jen nečitelný PODadresář 'locked' (vloží rel cestu, ne '.'). Žádný test neověří, že scanTree pro nečitelný kořen skutečně emituje '.'. Selhání: kdokoli zrefaktoruje scan.ts:74 (např. začne vkládat realRoot abs cestu nebo prázdný řetězec) – scan testy projdou (kontrolují jména podadresářů), cli.scanfail mock projde (má '.' natvrdo), ale reálné CLI se tiše vrátí k falešnému úspěchu (0-file report + exit 0), což byla původně třída nálezu 3-4. Pozn.: pod rootem je chmod 0o000 na kořeni nespolehlivý, proto reálný test je obtížný – řešením je sdílená konstanta (ROOT_SENTINEL) importovaná oběma stranami, nebo unit test scan.ts s mockem readdir.

## 3-9 · nit · resolved
**Where:** src/cli.ts:60 vs 102-104
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** mkdir(outDir) přesunut AŽ za scan+guard (cli.ts:411). Selhání scanu/guardu tak outDir nevytvoří. Zuby: cli.scanfail.test.ts:73-74 (access(outDir) → ENOENT) + kontrastní happy-path (ř.87) že vznikne.
Po-mkdir selhání nechávají osiřelý prázdný výstupní adresář (nový exit-1 z nečitelného kořene)

mkdir(outDir, {recursive:true}) běží na ř.60 PŘED scanem i guardem. Každá pozdější selhací větev (scanTree hodí ř.94, nečitelný kořen ř.104, selhání zápisu ř.118) skončí exit 1, ale vytvořený outDir (typicky ~/.vibeanalyzer/<jméno>) zůstane prázdný a neuklizený. Tahle fáze nově přidala exit-1 z nečitelného kořene, takže vznikl další způsob, jak po sobě nechat prázdný adresář. writeReportFiles sice best-effort maže report SOUBORY (a hláška na ř.116 to zmiňuje korektně), ale samotný vytvořený outDir neuklidí nikdo. Důsledek: opakované selhané běhy zaplevelují ~/.vibeanalyzer prázdnými složkami. Kosmetické, žádný funkční dopad – proto nit. Pokud by vadilo, vytvářet outDir až těsně před zápisem (po guardu).

## 3-10 · should-know · resolved
**Where:** src/cli.ts:108
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Write-fail větev uklízí vytvořený outDir přes rm(createdDir) (cli.ts:428-430); hláška cli.ts:431-434 nově zmiňuje i adresáře (nelže). Zuby: cli.writefail.test.ts:50-52 (access(outDir) → ENOENT).
Selhání zápisu nechá osiřelý prázdný outDir; hláška o úklidu lže

3-9 přesunul mkdir(outDir) až za scan/guard, aby tyhle větve nenechaly prázdný výstupní adresář. Ale write-failure větev to neřeší: mkdir(outDir) na ř.108 adresář VYTVOŘÍ, pak writeReportFiles selže (ENOSPC/EACCES/EROFS) a uklidí JEN dva soubory (unlink jsonPath/mdPath ve writeOutputs.ts:31-32) - rmdir(outDir) nikde v src není (ověřeno grepem). Prázdný outDir tedy na disku zůstane. Navíc hláška na ř.120-121 tvrdí 'Případný částečný výstup jsem se pokusil uklidit (best-effort)' - to je vůči adresáři nepravda. Tvrzení reportu 'po sobě nenechají osiřelý prázdný výstupní adresář' platí jen pro scan/guard, ne pro selhání zápisu. Reálné u read-only FS / kvóty.

## 3-11 · should-know · resolved
**Where:** src/cli.ts:69-80
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** try/catch kolem scanTree ODSTRANĚN (cli.ts:194 komentář 'ŽÁDNÝ try/catch ZÁMĚRNĚ'). Programová chyba ze scanTree probublá se stackem do bin.ts. Zuby: cli.scanfail.test.ts:45-56 pinuje propagaci (re-přidání catche test shodí).
scanTree obalen I/O catchem, ač je plně defenzivní → maskuje programovou chybu bez stacku

Komentář i report tvrdí, že try/catch kolem scanTree chytá I/O / TOCTOU. Jenže scanTree NIKDY na I/O nehodí: readdir/lstat/stat jsou všechny v interním try/catch (sype do skippedUnreadable) a oba realpath() mají .catch(). Jediné, co tenhle catch reálně zachytí, je programová chyba uvnitř scanTree (TypeProgram, RangeError z hluboké rekurze) - a tu pak vypíše jako 'cílovou složku se nepodařilo projít (neznámá chyba)' + exit 1, BEZ stacku (tiskne jen e.code a e.message). To je přesně ten anti-vzor, kvůli kterému 3-7 build* z catche VYNDAL (aby probublaly se stackem). Stejná úvaha se na scanTree neaplikovala → nekonzistence + porušení bodu 2 vlastního checklistu ('nemaskovat programovou chybu jako I/O, zachovat stack'). Buď scanTree z catche vyndat taky, nebo u neznámé chyby (e.code == null) přehodit dál místo polykání.

## 3-12 · nit · resolved
**Where:** src/cli.scanfail.test.ts:53
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** cli.scanfail.test.ts:73-74 nově asertuje, že po exit 1 z guardu outDir NEvznikne (access → ENOENT), plus kontrastní happy-path (ř.87) že vznikne. Regrese pořadí mkdir/scan se chytí.
3-9 (mkdir až po scanu) nemá test → regrese pořadí se nechytí

Klíčová záruka 3-9 'při selhání scanu/guardu outDir nevznikne' je v reportu ověřená jen ručně ('Ověřeno reálně'). Žádný automatický test netvrdí, že po exit 1 ze scan/guard větve outDir na disku NENÍ. cli.scanfail.test.ts kontroluje pouze návratový kód a hlášku. Když někdo mkdir vrátí zpět nad scan (kam patřil před 3-9), všechny testy zůstanou zelené a orphan-dir regrese projde. Stačilo by ve scanfail/guard testech doplnit assert, že fs.access(outDir) hodí ENOENT.

## 3-13 · nit · resolved
**Where:** src/cli.scanfail.test.ts:41
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Test přepsán (cli.scanfail.test.ts:45-56): už nevydává scanTree-throw za pokrytí I/O TOCTOU, ale poctivě pinuje propagaci programové chyby (nález 3-11). Zavádějící rámec odstraněn.
Test 'scanTree hodí' cílí na větev nedosažitelnou z reálného vstupu

Test mockuje scanTree na mockRejectedValueOnce(EIO) a ověřuje catch větev cli.ts:73-79. Jenže reálná scanTree na I/O nikdy nerejectne (viz nález 3-11), takže tahle 'TOCTOU s výjimkou' z reálného vstupu nenastane - test dává falešnou jistotu, že je ošetřená reálná I/O cesta. Reálný trigger té větve je jiný (RangeError z hluboké rekurze / programová chyba) a ten testovaný není. Není to past na regresi reálné logiky, jen kontrola tvaru hlášky pro umělý seam. Hodnota testu nízká; držet, ale nevydávat za pokrytí TOCTOU.

## 3-14 · should-know · resolved
**Where:** src/cli.ts:115
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** Write-fail maže jen createdDir z mkdir (cli.ts:428: undefined když outDir už existoval → nemažeme nic). Předem existující prázdný uživatelův outDir přežije. Zuby: cli.writefail.test.ts:67-76.
Write-fail úklid smaže i předem existující prázdný outDir, který nástroj nevytvořil

Větev catch po selhání writeReportFiles volá bezpodmínečně 'await rmdir(outDir)'. mkdir(outDir, {recursive:true}) na řádku 100 je no-op, když outDir UŽ existuje (vrací undefined - nic nevzniklo), ale ten návratový kód se ignoruje. Důsledek: když uživatel předá jako --out svůj vlastní PRÁZDNÝ adresář a zápis selže (ENOSPC apod.), rmdir ten uživatelův adresář smaže. Empiricky ověřeno: mkdir na existující dir vrací undefined, rmdir prázdný dir odstraní. Test cli.writefail.test.ts pokrývá jen (a) outDir vytvořený během běhu a (b) NEPRÁZDNÝ předem existující - varianta 'předem existující PRÁZDNÝ uživatelův adresář' chybí a kód ho smaže. Porušuje pravidlo 'nemaž, cos nevytvořil' a bod 5 self-checku (vedlejší efekt při selhání). Oprava: zachytit návrat mkdir (topmost created path) a rmdir volat jen když mkdir něco reálně vytvořil.

## 3-15 · nit · resolved
**Where:** src/cli.ts:100,115
**Reviewed-at:** 483e482cc1ec7475c517a9a74570452aa5e14202
**Source:** adversarial
**Reason:** rm(createdDir, {recursive:true}) maže NEJVYŠŠÍ vytvořenou cestu včetně mezičlánků (cli.ts:428-430). Zuby: cli.writefail.test.ts:78-88 (zanořený a/b/report → po selhání i proj/a pryč).
Write-fail úklid maže jen list outDir, zanořené rodiče vytvořené mkdir -p zůstanou osiřelé

U zanořeného --out (např. /proj/a/b/report, kde a ani b neexistují) mkdir(outDir,{recursive:true}) vytvoří všechny čtyři úrovně, ale write-fail catch volá jen 'rmdir(outDir)' = jen list 'report'. a a b zůstanou jako prázdné osiřelé adresáře. Empiricky ověřeno: mkdir vrátil nejvyšší vytvořenou cestu (/tmp/.../nested), rmdir(list) nechal a/b existovat. Cíl nálezů 3-9/3-10 ('selhání nenechá osiřelý prázdný výstupní adresář') je tedy splněn jen částečně. Testy pokrývají výhradně jednoúrovňový outDir (path.join(proj,'report'), kde proj existuje), takže tahle mezera není hlídaná. Stejná příčina jako 3-14: ignorovaná návratová hodnota mkdir (nejvyšší vytvořená cesta je přesně to, co se má uklidit).
