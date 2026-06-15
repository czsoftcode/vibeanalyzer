# Phase 1 — Kostra CLI a strom projektu

## Intent
Postavit spustitelnou kostru nástroje a strukturální základ (index souborů), ze
kterého budou čerpat všechny další fáze. Žádná analýza obsahu, žádné AI, žádné
parsování symbolů. Hmatatelný ověřitelný výsledek: nad reálným projektem vznikne
JSON index se správným seznamem souborů + MD s folder-diagramem, nic nespadne.

## Key decisions
- CLI: `vibeanalyzer <cesta>`; když cesta chybí, bere se `./`.
- Strom se projde JEDNOU, z týchž dat se vyrobí DVA výstupy (ne dvakrát počítat):
  - `vibeanalyzer-<timestamp>.json` — strojový strukturální index,
  - `vibeanalyzer-<timestamp>.md` — lidský report: seznam souborů + Mermaid blok.
- Výstup se ukládá do cesty z parametru `--out`; když není uvedena, do
  `~/.vibeanalyzer/<jméno projektu>/` (basename cílové cesty; pro kořen "root").
  Jméno souboru nese časové razítko (nepřepisuje předchozí běhy). Výchozí výstup
  mimo projekt = nešpiní analyzovanou složku a nezapočítá se příště do sebe.
- JSON index je STRUKTURÁLNÍ, ne symbolový. Tvar (návrh):
  `{ version, generatedAt, root, files: [{ path, type, ext, size, depth }] }`.
  Importy/exporty/signatury/řádkové kotvy (jako mini `graph/*.md`) jsou MIMO tuto
  fázi — patří do pozdější fáze "analýza kódu".
- Procházení přeskakuje pomocné složky: `node_modules`, `.git`, `.mini`, `dist`,
  `build`. Plné čtení `.gitignore` a chytřejší filtrování jsou mimo tuto fázi.
- Pozn.: `.mini` se v indexu/diagramu NEukazuje, ale `project.md` z něj bude číst
  až pozdější fáze cíleně (adresné čtení, ne součást procházení stromu).
- Symlinky se NEsledují (obrana proti zacyklení).
- Mermaid je jen na úrovni SLOŽEK (ne jednotlivých souborů), aby byl čitelný.
- Mermaid je textový blok v `.md` (```mermaid), NE vygenerovaný obrázek —
  vykreslí se jen v prohlížečích s podporou Mermaid (GitHub, VS Code apod.).
- Do terminálu se vypíše shrnutí běhu (počet souborů, kam se uložil výstup).

## Watch out for
- Neexistující/nečitelná zadaná cesta → jasná chyba, ne pád.
- Soubor bez práv ke čtení během procházení → přeskočit a poznamenat do reportu,
  ne spadnout (unhappy path musí doběhnout).
- Velký/hluboký strom: i folder-diagram může být rozsáhlý. Zvážit limit hloubky
  nebo počtu uzlů; pokud se ořízne, NAPSAT to v reportu (žádné tiché ořezání).
- Když uživatel nasměruje výstup DO analyzované složky, příští běh by si vlastní
  report mohl započítat — vyloučit vlastní výstupní soubory ze stromu.
- Základní TS scaffolding (package.json, tsconfig, vstupní bod) je součást této
  fáze — bez něj není co spustit; není to skrytá samostatná fáze.
