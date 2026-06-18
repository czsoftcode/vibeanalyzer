# Changelog

Všechny podstatné změny tohoto projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/)
a projekt používá [sémantické verzování](https://semver.org/lang/cs/).

## [Unreleased]

### Added

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

- JSON index má nově verzi 2 (přibylo pole `tsc` s výsledkem typové analýzy).

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
