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
- Výchozí výstup do `~/.vibeanalyzer/<jméno projektu>/` (lze přepsat přes `--out`),
  názvy souborů nesou časové razítko (nepřepisují předchozí běhy).
