# Changelog

Všechny podstatné změny tohoto projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/)
a projekt používá [sémantické verzování](https://semver.org/lang/cs/).

## [Unreleased]

### Added

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
- Procházení respektuje kořenový `.gitignore` analyzovaného projektu: co Git
  ignoruje (u Symfony typicky `vendor/`, `var/cache/`) se do indexu nezahrne a do
  ignorovaných složek se vůbec nevstupuje. Chybějící `.gitignore` nic nemění;
  nečitelný nebo s patologicky dlouhým vzorem se ohlásí varováním a procházení
  pokračuje bez něj. Když `.gitignore` odfiltruje úplně všechny soubory, report
  přesto vznikne, ale upozorní, že není co analyzovat.

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
