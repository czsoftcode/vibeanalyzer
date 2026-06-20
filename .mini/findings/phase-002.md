# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 2-1 · blocker · resolved
**Where:** src/report/writeOutputs.ts:20-31
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
writeReportFiles zanechá osiřelý soubor při selhání zápisu po open (ENOSPC/EFBIG/EIO)

Cíl fáze 1-3 (žádný osiřelý částečný výstup) NEPLATÍ pro realistický spouštěč. written.push(p) běží AŽ po vyřešení await writeFile, takže když zápis selže po otevření souboru (plný disk ENOSPC, kvóta EDQUOT, EFBIG, I/O chyba EIO), je soubor na disku VYTVOŘEN (open+truncate uspěl), ale do written se nedostane → catch ho neuklidí. Empiricky reprodukováno: pod 'ulimit -f 0' selže zápis JSON s EFBIG, v adresáři zbyl osiřelý out.json. Pokud projde JSON a selže MD uprostřed zápisu, zbyde naopak částečně zapsaný MD. Tj. právě ten realistický důvod selhání druhého zápisu (disk plný) garanci porušuje. Oprava je zároveň JEDNODUŠŠÍ: v catch bezpodmínečně unlink(jsonPath).catch() i unlink(mdPath).catch() — smaže i částečně zapsaný/vytvořený soubor; neexistující dá ENOENT (spolknuto). Pole 'written' je tak složitější A méně správné než naivní úklid obou cest.

## 2-2 · should-know · resolved
**Where:** src/report/writeOutputs.test.ts:36-60
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Test 1-3 pokrývá jen EISDIR — jediný režim, který osiřelý soubor vyrobit nemůže

Oba chybové testy simulují selhání tím, že cílová cesta je adresář (EISDIR). EISDIR selže UŽ při open(), takže žádný soubor nevznikne — proto se osiřelý výstup nikdy neobjeví a test 'projde'. Falešná jistota: skutečný spouštěč selhání druhého zápisu (plný disk / kvóta / EFBIG / EIO) selže AŽ při write() po vytvoření souboru a osiřelý soubor zanechá (viz 2-1). Chybí test pro write-after-open (lze deterministicky přes 'ulimit -f 0' v subprocesu, nebo mockem fs/promises.writeFile, který poprvé uspěje a podruhé rejectne po 'vytvoření' souboru).

## 2-3 · should-know · resolved
**Where:** src/scan.test.ts:80-90
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
fifo test se bez mkfifo tiše přeskočí — projde bez jediné assertion

Když mkfifo selže/neexistuje (jiná platforma, omezené prostředí), catch blok udělá 'return' a test skončí jako passed, aniž cokoli ověřil. Zelená barva pak nedokazuje, že větev 'zvláštní typ → skippedUnreadable' funguje. Lépe: vitest it.skip s důvodem (test viditelně skipped, ne falešně passed), nebo dořešit DT_UNKNOWN cestu portovatelným mockem readdir vracejícím Dirent s d_type=UNKNOWN.

## 2-4 · nit · resolved
**Where:** src/report/writeOutputs.ts:10-19
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
writeReportFiles: doc komentář slibuje návratovou hodnotu, ale funkce vrací void

Komentář tvrdí 'Vrací cesty, které po (případném) úklidu reálně zůstaly zapsané... při úspěchu oba soubory; při chybě prázdné pole', ale signatura je Promise<void> a nic se nevrací. Zavádějící dokumentace — buď doplnit návratovou hodnotu (a volající by ji mohl logovat), nebo komentář opravit, ať neslibuje neexistující API.

## 2-5 · should-know · resolved
**Where:** src/scan.ts:105
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Vyloučení outDir je porovnání řetězců 1:1, přes symlink tiše selže

Vyloučení běží jako excludePaths.has(abs), kde abs = path.join(absDir, name) postavené od targetPath. path.resolve normalizuje '..'/'.', ale NErozbaluje symlinky. Reálný spouštěč z CLI: 'vibeanalyzer /mnt/x/proj --out ~/proj/report', kde ~/proj je symlink na /mnt/x/proj. targetPath=/mnt/x/proj -> abs=/mnt/x/proj/report; outDir=path.resolve(~/proj/report)=/home/u/proj/report. Řetězce se nerovnají -> vlastní výstupní adresář se NEvyloučí a zaindexuje (a roste s každým během). Přesně cíl 1-1 ('výstupní adresář se nezapočítá') má tichou díru. Funkce navíc nemá žádnou normalizaci/guard ani test na neabsolutní/nekanonickou cestu v excludePaths -> chyba kaskáduje potichu.

## 2-6 · should-know · resolved
**Where:** src/scan.ts:91-94, src/scan.test.ts
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Jádro 1-2 (DT_UNKNOWN -> dořešit a ZAINDEXOVAT skutečný soubor/složku) je netestované

Smysl 1-2 nebyl jen 'nezahodit tiše', ale taky 'skutečný soubor/složku, kterou readdir neoznačil typem, normálně zaindexovat' (větve st.isDirectory()/st.isFile() na řádcích 91-94). Tahle 'recovery' větev nemá JEDINÝ test. Fifo test pokrývá pouze opačný výsledek (zvláštní typ -> skippedUnreadable). DT_UNKNOWN se těžko vynutí (FS bez d_type), a scanTree nemá injekční hook na typ Direntu, takže ta nejdůležitější část fixu 1-2 zůstává zcela neověřená -> mohla by tiše regresovat (např. že by se i regulérní soubor omylem dostal do skippedUnreadable).

## 2-7 · nit · open
**Where:** src/report/writeOutputs.ts:31-32
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Úklid ve writeReportFiles maže podle cesty bezpodmínečně (ne 'co jsem vytvořil')

catch dělá unlink(jsonPath)/unlink(mdPath) na cesty bez ohledu na to, jestli ten soubor vytvořil tenhle běh. Sémantika je 'smaž, co je na té cestě', ne 'smaž, co jsem zapsal'. V praxi to chrání milisekundové razítko v názvu (kolize skoro nemožná), takže nízká priorita; ale při souběžném běhu se stejným outDir+cílem ve stejné ms, nebo když na té cestě z jakéhokoli důvodu předtím soubor existoval, by se cizí/validní soubor tiše smazal. Před touhle fází selhání soubory NEchávalo; teď je aktivně maže.

## 2-8 · nit · resolved
**Where:** src/scan.test.ts:96
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Fifo test se skipuje bez mkfifo -> na takovém CI nula assertion pro zvláštní typy

it.skipIf(!hasMkfifo) je poctivější než starý tichý try/return, ale na platformě/CI bez mkfifo je CELÁ větev zvláštních typů (lstat fallback -> fifo/socket/device) bez jediné assertion. Report to přiznává, přesto je to reálná díra v pokrytí na ne-POSIX nebo osekaných prostředích. Šlo by doplnit alternativní vynucení (např. socket přes net modul) nebo aspoň test, který skip viditelně vykáže.

## 2-9 · should-know · resolved
**Where:** src/cli.ts:71
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Napojení cli→scanTree(excludePaths) nemá automatický test

Vlastní cíl 1-1 (vyloučení outDir z indexu) je v produkčním kódu jen na řádku cli.ts:71. scan.test.ts ověřuje MECHANISMUS excludePaths izolovaně voláním scanTree přímo, ale nikdo netestuje, že cli ten Set skutečně předá. cli.ts nemá žádný test (run() není exportovaný). Když někdo ten řádek smaže/rozbije (např. refaktor argumentů), VŠECH 30 testů zůstane zelených a výstupní adresář se zase začne indexovat a růst každým během – přesně regrese, kterou fáze opravovala. Ověřeno jen ručním E2E, což zmizí při dalším refaktoru.

## 2-10 · should-know · resolved
**Where:** src/scan.ts:101
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Větev DT_UNKNOWN→lstat zjistí symlink→continue nemá test

Na FS bez d_type vrátí readdr DT_UNKNOWN i pro symlink (ent.isSymbolicLink()===false). Spadne do else, lstat(abs), a JEDINÁ ochrana proti sledování symlinku v této větvi je 'if (st.isSymbolicLink()) continue' na řádku 101. Tahle větev nemá žádný test: test 'DT_UNKNOWN soubor' (scan.test.ts:144) testuje reálný soubor, test 'zvláštní typ' (160) vrací specialStat() který NENÍ symlink. Symlink-přes-DT_UNKNOWN scénář není pokrytý vůbec. Když refaktor tu jednu řádku omylem zahodí, testy projdou a nástroj začne sledovat symlinky (zacyklení / únik mimo strom) na d_type-less FS. Bezpečnostně relevantní guard bez sítě.

## 2-11 · nit · open
**Where:** src/scan.ts:96,123
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Dvojí stat na DT_UNKNOWN souborech (lstat + stat)

U entry bez d_type, který je soubor, se volá lstat(abs) na řádku 96 (zjištění typu) a pak ještě stat(abs) na 123 (velikost). lstat už st.size obsahuje. Dva syscally místo jednoho. Týká se jen FS bez d_type (vzácné), takže opravdu jen nit – ale pokud by se velikost vzala rovnou z lstatu, kód by byl o jednu chybovou cestu kratší (stat na 123 má vlastní catch→skippedUnreadable, který může soubor přesunout mezi nečitelné i když lstat prošel – nekonzistence).

## 2-12 · blocker · resolved
**Where:** src/cli.ts:113-126
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
isMain guard zabíjí CLI při instalaci jako npm bin (symlink)

Fáze 2 (fix 2-9) přidala kolem run() guard: isMain = path.resolve(process.argv[1]) === fileURLToPath(import.meta.url). Cíl byl správný (jít run() importovat v testu), ale rozbil produkční vstupní bod. package.json má bin: { vibeanalyzer: dist/cli.js } a npm při 'npm i -g' (i lokálně přes node_modules/.bin) vytvoří SYMLINK na cli.js. Node u main modulu defaultně dereferencuje symlink, takže import.meta.url = realpath cli.js, ale process.argv[1] = cesta symlinku (path.resolve symlink NErozbaluje). => nerovnost => isMain=false => run() se NIKDY nezavolá. Ověřeno empiricky i na reálném buildu: 'node dist/cli.js --help' vypíše help, ale 'node <symlink-na-dist/cli.js> --help' nevypíše NIC a skončí exit 0. Tj. po instalaci je celý nástroj mrtvý (tichý no-op, exit 0 = vypadá jako úspěch). Funguje jen dev cesta (tsx src/cli.ts) a 'npm start' (node dist/cli.js přímo) – proto to lokálně 'prošlo'. Fix: porovnávat realpath obou stran (fs.realpathSync(process.argv[1])), nebo použít process.argv[1] && fileURLToPath(import.meta.url) přes realpathSync, případně knihovní pattern. Regrese se neprojeví v žádném testu (viz samostatný should-know).

## 2-13 · should-know · resolved
**Where:** src/cli.test.ts:5,31
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
isMain vstupní bod nemá žádný test – regrese projde zeleně

cli.test.ts importuje run() PŘÍMO (import { run } from ./cli.js a volá run([...])), čímž celý isMain guard obchází. Auto-spuštění (isMain && run()) – tedy jediná věc, která dělá z balíčku spustitelný program – nemá nulové pokrytí. Proto blocker 2-12 (mrtvé CLI přes symlink) projde 'vitest run' zeleně. Ironie: guard byl přidán kvůli testovatelnosti (2-9), ale to, co reálně rozhoduje o spustitelnosti binárky, zůstalo netestované => falešná jistota. Smysluplný test: spawnout reálný node proti zbuildovanému dist/cli.js přes symlink (execFile) a ověřit, že vypíše výstup / nenulový smysluplný kód, ne tichý no-op. Čistě in-process test isMain neověří (musí běžet jako main modul).

## 2-14 · should-know · resolved
**Where:** src/scan.ts:102-118; src/scan.test.ts
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
DT_UNKNOWN → adresář (lstat→isDirectory→rekurze) nemá žádný test

Fix 1-2 dořeší typeless Dirent (DT_UNKNOWN) přes lstat. Tři testy pokrývají větve →soubor, →zvláštní typ, →symlink, ale NE větev →adresář (st.isDirectory() → kind=dir → push + await walk). Přitom na FS bez d_type (overlayfs v Dockeru, NFS, FUSE – přesně to prostředí, kvůli kterému 1-2 vzniklo) přijde KAŽDÝ adresář jako DT_UNKNOWN a projde právě touhle nepokrytou cestou. Rekurze přes lstat-resolved adresář je tam hlavní průchozí větev, a má nula pokrytí → regrese (špatný kind, vynechaná rekurze) by tiše zahodila celé podstromy = právě ten silent data-loss, který 1-2 měl zabít. Past při psaní testu: stávající globální readdir spy vrací stejný entry pro každou cestu, takže naivní 'udělej z toho adresář' zacyklí walk donekonečna – mock musí být path-aware (pro podadresář vrátit prázdný seznam).

## 2-15 · should-know · resolved
**Where:** src/cli.test.ts; src/cli.ts:47-98
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
**Reason:** run() chybové větve nově otestovány se zuby: neplatný cíl → exit 1 (cli.test.ts:69-73), mkdir selže (ENOTDIR) → exit 1 (cli.test.ts:75-85), writeReportFiles selže → exit 1 (cli.writefail.test.ts:43-53), scan/guard (cli.scanfail.test.ts:58-75). Smazání řádku větve test shodí.
run() chybové větve (neplatný cíl, mkdir, zápis) nemají žádný test

run() byla v této fázi exportována kvůli testovatelnosti (fix 2-9) a dostala happy-path integrační test (výstupní adresář se nezaindexuje). Ale VŠECHNY její chybové cesty zůstaly bez automatického testu: kind=='error' → exit 2 (ř.47-51), neplatný cíl → exit 1 (56-60), mkdir selže → exit 1 (62-68) a hlavně NOVÝ překlad chyby z writeReportFiles → hláška + exit 1 (89-98). writeReportFiles je sice unit-testovaná izolovaně (2-1/2-2), ale to, že cli ji obalí, vrátí exit 1 a vypíše hlášku, netestuje nikdo – stejnou logikou, kterou byl odůvodněn finding 2-9 (smazání jednoho řádku projde zeleně), tu chybí síť i pro chybové exity. Regrese (špatný exit kód, spolknutá chyba, zapomenuté return) zůstane zelená. Cíl fáze 1-3 ('po selhání MD zápisu exit + úklid') je na CLI úrovni ověřen jen ručním E2E, které zmizí při dalším refaktoru.

## 2-16 · should-know · open
**Where:** src/report/writeOutputs.ts:26-34
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Pár-atomicita zničí úspěšně zapsaný JSON index, když selže jen MD

Když JSON zápis projde a teprve MD selže (ENOSPC/EFBIG/EIO), catch BEZPODMÍNEČNĚ smaže i ten validní JSON. JSON je strojový produkt nástroje (index), MD je lidský report – jsou to dva nezávislé artefakty, ne transakce. Default 'buď oba, nebo žádný' znamená, že flaky druhý zápis (třeba MD je o řád větší a trefí EFBIG dřív než JSON) zahodí i hodnotný strojový výstup → uživatel nedostane NIC + exit 1. Není to bug (je to přímý důsledek záměrného návrhu a hláška to přiznává slovem best-effort), ale je to debatovatelná volba, kterou by měl člověk před 'done' vědomě potvrdit: protiargument 'půlvýstup by se mohl splést s kompletním' je legitimní, ale stejně tak 'radši mít JSON než nic'. Patří k ADR, který fáze beztak zvažuje (temp+rename). Označuju jako rozhodovací bod, ne jako defekt.

## 2-17 · nit · resolved
**Where:** src/cli.ts:122-129
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
isEntrypoint selhává 'closed' (catch → false) – tvarem stejný tichý no-op jako 2-12

isEntrypoint vrací false na JAKOUKOLI výjimku z realpathSync (try/catch kolem obou stran). Pro detektor vstupního bodu to znamená fail-closed: když realpathSync(resolve(argv[1])) hodí (argv[1] míří na neexistující/odlinkovanou cestu, exotický spouštěč/bundler/loader, kde argv[1] není reálný soubor), run() se nezavolá → tichý no-op, exit 0 = vypadá jako úspěch. To je přesně symptom blokeru 2-12, jen jiným kanálem. Reálná pravděpodobnost je nízká (aby tenhle modul běžel jako main, jeho soubor existuje, a v běžném node CLI argv[1] vždy ukazuje na reálný soubor), proto jen nit – ale stojí za vědomí, že 'oprava' 2-12 zabudovala catch-all, který selhává do stejného tvaru chyby, jaký 2-12 řešil. Bezpečnější by bylo fail-open nebo aspoň odlišit chybu realpathu od skutečné neshody.
