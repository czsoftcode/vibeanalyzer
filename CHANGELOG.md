# Changelog

Všechny podstatné změny tohoto projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/)
a projekt používá [sémantické verzování](https://semver.org/lang/cs/).

## [Unreleased]

### Changed

- Minifikáty (`*.min.js`, `*.min.css` apod.) report nově řeší **konzistentně napříč
  všemi sekcemi**, ne jen v ESLintu. Dřív jedna sekce bundle přeskočila a o pár řádků
  níž ho strom i počty zase vypsaly – report si protiřečil. Nově: počet souborů uvádí
  dovětek `(z toho M minifikátů)`, seznam souborů minifikát viditelně značí, graf
  modulů je z grafu vyřadí (nekreslí hrany do/z bundlu) a počítá je zvlášť, a souhrn
  i sekce grafu počet vyřazených hlásí. Rozhodnutí: minifikáty se **neskrývají, jen
  označí** – strukturální mapa dál ukazuje, co na disku fyzicky je. Rozpoznání zůstává
  v1 jen podle jména `*.min.<přípona>` (bundly bez té konvence jako `bundle.js` projdou
  – report to přiznává). Pozn.: skener tajemství minifikáty zatím skipuje bez vlastního
  počítadla (sjednocení i tam je v plánu). JSON index proto povýšil na verzi 8 (každý
  soubor nese příznak `minified`, graf modulů počítadlo vyřazených).
- Filtr minifikátů v ESLint vrstvě: minifikované soubory (`*.min.js`, `*.min.css`
  apod.) se už neposílají do ESLint analýzy. Dřív generovaný bundle zaplavil report
  falešnými nálezy (fatální „Parsing error" nebo desítky zásahů pravidel) o cizím,
  nepsaném kódu. Report počet přeskočených minifikátů uvádí explicitně – v sekci
  ESLint i v rychlém přehledu, takže „čistý" netají, že nějaké soubory linter vůbec
  neviděl. Omezení v1: rozpoznání je jen podle jména `*.min.<přípona>`, takže bundly
  bez té konvence (`bundle.js`) filtrem projdou a lintují se dál – report to přiznává.

### Added

- Graf modulů: report nově kreslí Mermaid diagram importních závislostí mezi
  zdrojovými soubory projektu (šipka A → B = „A importuje B"). Spolehlivé a lokální,
  bez AI – importy se vytahují parserem TypeScriptu (ne regexem), takže importy
  schované v komentářích/řetězcích nedělají falešné hrany a víceřádkové importy se
  trefí. Kreslí jen statické relativní importy (`import … from`, side-effect importy,
  `export … from`); dynamický `import()`/`require()`, externí balíky a `tsconfig`
  path-aliasy se nezobrazují (report to přiznává jako přibližnost). Klíčové: import
  s příponou `.js` se správně napojí na zdroj `.ts`/`.tsx`. Soubory bez jediné vazby
  se vypíšou jako „osamělé moduly", ne kreslí. Graf nad ~480 hran se ořízne (s
  poznámkou), aby nenarazil na tvrdý 500hranový limit Mermaidu a vůbec se vykreslil –
  úplné hrany zůstávají v JSON indexu. JSON index proto povýšil na verzi 7 (nese
  pole `moduleGraph`).
- Audit závislostí (volitelný, přepínač `--audit`): report nově hlásí zranitelné npm
  závislosti přes `npm audit` (balík, závažnost, CVE/GHSA, jestli existuje oprava).
  Je to síťová operace, proto se spustí jen na výslovné přání – bez `--audit` se
  vrstva přeskočí a výchozí běh zůstává offline. `--audit --dev` zahrne i vývojové
  závislosti (jinak jen produkční). Kvůli bezpečnosti se `npm audit` pouští nad kopií
  `package.json`+`package-lock.json` v dočasném adresáři s vynuceným oficiálním
  registry, takže se nepřečte `.npmrc` analyzovaného projektu (obrana proti
  přesměrování na cizí registry). Podporován je jen npm lockfile (ne yarn/pnpm);
  bez lockfilu nebo bez sítě se vrstva čistě přeskočí s konkrétním důvodem. JSON
  index proto povýšil na verzi 6 (nese pole `audit`).
- Strojové hledání tajemství: report nově hlásí pravděpodobné klíče a tokeny v kódu
  (privátní PEM klíče, AWS, GitHub, Google, Slack, Stripe) s odkazem na `soubor:řádek`.
  Skener čte i jinak ignorované soubory typu `.env`/`*.pem`/`id_rsa` u kořene projektu,
  přeskakuje binárky, velké soubory a minifikáty. Hledá záměrně jen známé tvary
  (radši míň, ale důvěryhodných nálezů), takže neznámé klíče může minout – sekce
  reportu na to upozorňuje. **Hodnota tajemství se do reportu nikdy nevypíše celá**,
  jen maskovaný náznak (např. `AKIA…`), aby commitovaný `.md`/JSON tajemství neunesl dál.
  JSON index proto povýšil na verzi 5 (nese pole `secrets`).

### Changed

- Vývojový test runner `vitest` povýšen z řady 2 (2.1.9) na 4.1.9. Šlo o major
  skok, protože 2.1.9 byla poslední verze řady 2 a žádný 2.x patch neexistoval.
  Bez dopadu na chování nástroje – mění se jen dev toolchain, publikuje se dál
  jen `dist/`. Celá testová sada (241 testů) zůstává zelená.
- Klíč adresáře projektu pod `~/.vibeanalyzer/` (kam se ukládá report i záměr) se
  nově odvozuje pomocí SHA-256 místo SHA-1. Jde o úklid kvůli bezpečnostnímu
  skeneru, ne o reálnou bezpečnostní díru – hash tu jen tvoří krátký deterministický
  klíč z cesty, nechrání žádná citlivá data. Pozor: protože se klíč změnil, projekty
  analyzované starší verzí dostanou pod `~/.vibeanalyzer/` novou složku a dříve
  uložené reporty/záměry zůstanou pod původním (starým) klíčem jako osiřelé. Tvar
  klíče (`jméno-složky-<8 hex>`) i chování jinak zůstávají stejné.

### Security

- Odstraněn kritický supply-chain nález CVE-2026-47429 (path traversal ve Vitest
  UI serveru) povýšením `vitest` na 4.1.9. Zranitelnost se týkala jen řady 2.x a
  v projektu byla i tak nedosažitelná (`@vitest/ui` se neinstaluje, test runner je
  dev-only a nepublikuje se). `npm audit` nově hlásí 0 zranitelností.

## [0.2.0] - 2026-06-19

### Changed

- Strojová typová analýza (tsc) běží na přibaleném TypeScriptu 6.0.3 (povýšeno z 5.9).
  Záměrně se nenačítá (a tedy nespouští) TypeScript z `node_modules` analyzovaného
  projektu – vždy se použije přibalený, čímž nástroj drží slib „čte, nespouští" i pro
  tuhle vrstvu. Verzi TypeScriptu projektu jen přečte z jeho `package.json` a když se
  liší, report u tsc poznamená, kterou verzí se typovalo a kterou projekt používá.
  Povýšení na 6.0 drží nástroj na aktuální stabilní řadě před příchodem nativního
  TypeScriptu 7 a je bez dopadu na chování (build, typecheck i celá testová sada
  zelené, tvar nálezů beze změny). Pozor: u analyzovaných projektů bez explicitní
  konfigurace `tsconfig` (nové výchozí hodnoty 6.0 – strict, novější knihovna) se může
  report o něco více lišit od toho, co by nahlásil jejich vlastní toolchain – proto je
  výše uvedená poznámka o verzním rozdílu důležitější než dřív.

### Security

- Typová analýza (tsc) už nepřečte soubory mimo analyzovaný projekt, i když na ně
  podvržený `tsconfig.json` cílí. Dřív mohl klonovaný cizí repozitář přes `files`/
  `include` (cesty s `../` nebo absolutní), přes `extends` nebo přes symlink uvnitř
  projektu mířící ven donutit nástroj přečíst libovolný soubor na disku a vtáhnout
  jeho obsah/cestu do reportu (sondování souborového systému). Teď se takové cesty
  vynechají z analýzy a nahlásí jako varování v reportu; když na ně tsconfig míří
  jen na soubory mimo projekt, vrstva se přeskočí s pravdivým důvodem. (Zbývá známé
  omezení: `import`/`/// <reference path>` uvnitř zdrojáků zatím mimo tohle zadržení.)

- Název souboru v reportu se sanitizuje i proti zalomení řádku (CR/LF), ne jen proti
  zpětnému apostrofu. Soubor se zákeřným jménem (na Linuxu smí obsahovat newline) už
  nerozbije odrážku ani nepodstrčí do MD reportu falešný nadpis.

### Added

- Strojová lint analýza (ESLint): nástroj projede JS/TS soubory projektu (jen je
  čte/parsuje, kód projektu nespouští ani nic nezapisuje) a hlásí pravděpodobné
  bugy, které typová kontrola nevidí – `==` místo `===`, prázdný `catch`,
  zapomenutý `debugger`, omylem přiřazení v podmínce, duplicitní klíče, nedosažitelný
  kód, `switch` bez `break`. Nálezy jsou v nové sekci „Strojové
  nálezy (ESLint)" v MD i v poli `eslint` JSON indexu, se `soubor:řádek:sloupec`,
  závažností, pravidlem a zprávou. Z bezpečnostních důvodů se používá pevný ruleset
  vibeanalyzeru (jen pravidla na bugy, žádný styl) a projektový `eslint.config.js`
  se záměrně nenačítá (jeho spuštění by znamenalo spustit cizí kód). Když projekt
  nemá JS/TS soubory, vrstva se čistě přeskočí. Nálezy nemění návratový kód.

- Strojová typová analýza (tsc): nástroj pustí TypeScript kompilátor v režimu
  kontroly (jen čte, nic nespouští ani nezapisuje do projektu) nad analyzovaným
  projektem a typové chyby zapíše do reportu jako `soubor:řádek:sloupec` se
  závažností, kódem (např. `TS2322`) a zprávou – v nové sekci „Strojové nálezy
  (tsc)" v MD i v poli `tsc` JSON indexu. Report odlišuje tři stavy: nálezy /
  čistý projekt (0 chyb) / přeskočeno (s důvodem) – „čistý" se neplete s
  „neproběhlo". Když projekt nemá `tsconfig.json` nebo je rozbitý, vrstva se čistě
  přeskočí (report nespadne). Chyby konfigurace (např. `extends` na neexistující
  soubor, neznámá volba) se hlásí jako nálezy, ne tiše zahodí. Když v projektu
  chybí `node_modules`, report to přizná (chyby „nenalezený modul" jsou za té
  situace očekávané). TypeScript se bere z `node_modules` projektu (jeho verze),
  jinak z přibaleného. Nálezy v analyzovaném projektu nemění návratový kód.

### Changed

- Mermaid diagram struktury složek se kreslí zleva doprava (`graph LR`) místo
  shora dolů. Sourozenecké složky se teď skládají pod sebe, takže graf roste do
  výšky a ne do šířky – u projektů s mnoha složkami je čitelnější. Zároveň se
  zvedl strop vykreslených uzlů z 60 na 1000, takže i projekt se stovkami složek
  se v diagramu zobrazí celý (ověřeno na 1100 souborech / 343 adresářích). Nad
  1000 uzlů se diagram dál poctivě ořízne s poznámkou, kolik z kolika složek je
  vidět.

- Strojová analýza (tsc i ESLint) teď běží v odděleném podprocesu s limitem paměti
  a časovým limitem. Na obřím projektu, kde by dřív mohla vyčerpat paměť (a shodit
  celý nástroj) nebo se zaseknout, se místo pádu čistě označí jako přeskočená
  s konkrétním důvodem („příliš velký projekt", „trvalo příliš dlouho") – report
  vždy vznikne. Cena: každý běh má kvůli izolaci o ~1–2 s vyšší režii.

- JSON index má nově verzi 4 (přibyla pole `tsc` a `eslint` s výsledky strojových analýz;
  tsc výsledek nese i verzi použitého TypeScriptu, případně verzi deklarovanou projektem).

- Když záměr projektu (`project.md`) nikde není a nástroj běží v terminálu, nabídne
  jeho vytvoření: pár otázek (co stavíš + non-goaly), uloží `project.md` do
  `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/` a rovnou ho použije pro tenhle
  report. Do analyzovaného projektu se nic nezapisuje. Při běhu bez terminálu
  (pipe, CI, přesměrování) se nástroj na nic neptá a chová se jako dosud (vypíše
  jen tip, jak záměr dodat ručně). Vytvoření záměru nikdy neshodí samotný report –
  i když se uložení nepovede, report přesto vznikne.

- CLI `vibeanalyzer [cesta] [--out <dir>]`: projde strom projektu a vygeneruje
  strojový JSON index a lidský MD report s Mermaid diagramem struktury (jen složky).
- Procházení přeskakuje pomocné složky (`node_modules`, `.git`, `.mini`, `dist`,
  `build`), nesleduje symlinky a nečitelné soubory přeskočí a zaznamená do reportu.
- Výchozí výstup do `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/` (lze přepsat
  přes `--out`), názvy souborů nesou časové razítko (nepřepisují předchozí běhy).
  Hash v názvu složky odděluje projekty se stejným jménem z různých cest, takže si
  navzájem nepřepíšou výstup.
- Report v hlavičce uvádí záměr projektu a deklarované non-goaly načtené z
  `.mini/project.md` (případně `project.md`) analyzovaného projektu, a nově i z
  `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/project.md` (společná složka s
  výstupem) jako třetí zdroj v pořadí. Záměr je volitelný: když chybí nebo je
  prázdný, report normálně doběhne, uvede explicitní „záměr nedodán" a poradí, jak
  ho dodat. Nečitelný soubor jen ohlásí varováním. Nástroj do analyzovaného
  projektu nic nezapisuje.
- Procházení respektuje `.gitignore` analyzovaného projektu, a to nejen kořenový,
  ale i vnořené v podsložkách: co Git ignoruje (u Symfony typicky `vendor/`,
  `var/cache/`) se do indexu nezahrne a do ignorovaných složek se vůbec nevstupuje.
  Vnořená pravidla platí pro svůj podstrom, hlubší má přednost před mělčím a
  funguje i re-include přes `!` (např. `*.log` v `src/` a `!keep.log` v `src/sub/`).
  Chybějící `.gitignore` nic nemění; nečitelný nebo patologický (příliš dlouhá
  řádka či příliš velký soubor) se ohlásí varováním a procházení pokračuje bez
  pravidel té jedné složky. Když `.gitignore` odfiltruje úplně všechny soubory,
  report přesto vznikne, ale upozorní, že není co analyzovat.

### Fixed

- ESLint vrstva už nehlásí falešný „Parsing error" na zdravém JSX. Validní `.jsx`
  a `.js` se syntaxí JSX (typicky React) se teď korektně naparsují místo toho, aby
  skončily jako falešný `error` nález na řádku 1. Zároveň se přestaly vypisovat
  falešné nálezy „nepoužitá proměnná" na importech komponent a React pragmě
  (jádrový lint JSX použití nevidí); detekce nepoužitých proměnných je proto
  vypnutá – ostatní kontroly bugů běží beze změny.
- Výstupní adresář ležící uvnitř analyzované složky se už nezapočítá do indexu –
  a to i když je zadán přes symlink (jinak by report rostl každým během).
- Položky neznámého/zvláštního typu (na souborových systémech bez `d_type`, dále
  fifo/socket/zařízení) se už tiše nezahazují – zaznamenají se mezi přeskočené.
- Při selhání zápisu reportu (např. plný disk) nezůstane na disku osiřelý částečný
  výstup; nástroj uklidí jen to, co sám kvůli zápisu vytvořil (včetně zanořených
  adresářů), nikdy ne předem existující cizí adresář, a vrátí jasnou chybu.
- Když cílová složka mezi kontrolou a průchodem zmizí nebo přestane být čitelná,
  nástroj vrátí chybu a nenulový kód místo tichého prázdného reportu (dřív vypadal
  jako úspěch). Legitimně prázdná složka je dál v pořádku.
- Chybové cesty CLI (neplatný cíl, nevytvořitelný výstupní adresář, selhání zápisu)
  spolehlivě končí nenulovým kódem s konkrétní hláškou, ne pádem ani tichým úspěchem.
- Non-goal zadaný při tvorbě záměru s vedoucí odrážkou (např. „- Nespouštět kód")
  se ve vygenerovaném `project.md` už nezobrazí se zdvojenou odrážkou („- - …").
- Interaktivní dotaz na záměr po sobě vždy spolehlivě zavře vstup, takže se proces
  po zodpovězení otázek nezasekne – i kdyby vlastní běh skončil chybou.
