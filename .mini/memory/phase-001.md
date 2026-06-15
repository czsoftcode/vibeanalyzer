# Phase 1 — Kostra CLI a strom projektu

**Goal:** CLI vezme cestu ke složce, projde jen vlastní strom projektu (přeskočí pomocné složky node_modules, .git, .mini, dist, build) a vygeneruje .md report se seznamem souborů a Mermaid diagramem struktury. Plné čtení .gitignore a chytřejší filtrování jsou mimo tuto fázi.

## Steps
- [done] Scaffolding a spustitelná kostra CLI
- [done] Zpracování argumentu cesty a validace
- [done] Procházení stromu do datového modelu
- [done] Zápis JSON indexu
- [done] Zápis MD reportu s folder-level Mermaidem
- [done] Shrnutí v terminálu a průchod unhappy path

## Auto-commit
- Phase 1: Kostra CLI a strom projektu

## Discussion
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

## Run report
---
phase: 1
verdict: done
steps:
  - title: "Scaffolding a spustitelná kostra CLI"
    status: done
  - title: "Zpracování argumentu cesty a validace"
    status: done
  - title: "Procházení stromu do datového modelu"
    status: done
  - title: "Zápis JSON indexu"
    status: done
  - title: "Zápis MD reportu s folder-level Mermaidem"
    status: done
  - title: "Shrnutí v terminálu a průchod unhappy path"
    status: done
verify:
  - title: "Vykreslení Mermaid diagramu v prohlížeči"
    detail: "Ověřil jsem, že MD obsahuje validně vypadající blok ```mermaid graph TD``` s uzly a hranami, ale skutečné vykreslení obrázku jsem netestoval (vyžaduje GitHub/VS Code s podporou Mermaid). Otevři některý vygenerovaný .md a zkontroluj, že se strom složek opravdu nakreslí."
---

# Phase 1 — report z auto session

## Co je hotové
Postavena spustitelná kostra nástroje (ESM TypeScript, Node 24). Příkaz
`vibeanalyzer [cesta] [--out <dir>]` projde strom projektu a vyrobí dva výstupy
s časovým razítkem: strojový `*.json` index a lidský `*.md` report s folder-level
Mermaid diagramem. Strom se prochází jednou, oba výstupy vznikají z téhož modelu.

Struktura kódu:
- `src/args.ts` — parsování argumentů (čisté, bez I/O) + validace cílové cesty.
- `src/scan.ts` — průchod stromem do modelu `{ path, type, ext, size, depth }`.
- `src/report/jsonIndex.ts` — sestavení JSON indexu.
- `src/report/markdown.ts` — MD report + Mermaid diagram (jen složky).
- `src/cli.ts` — orchestrace + výpis shrnutí.
- `src/version.ts`, `src/timestamp.ts` — drobné pomůcky.

## Ověřeno (mechanicky)
- `npm run typecheck` čistý, `npm run build` vyrobí `dist/`.
- 19 vitest testů prošlo (args, scan, markdown) — pokrývají i unhappy path:
  neexistující cesta, soubor místo adresáře, nečitelná složka, symlink (nezacyklí),
  ořez diagramu při překročení limitu.
- `--help` → exit 0, `--version` → `0.1.0`, neexistující cesta → exit 1 se
  srozumitelnou hláškou, neznámá volba → exit 2.
- Reálný běh nad mini-orchestrator: 291 souborů / 29 složek, `node_modules`,
  `.git`, `.mini`, `dist`, `build` korektně vynechány, JSON má správný tvar,
  MD obsahuje mermaid blok.
- End-to-end test nečitelné složky: běh doběhl (exit 0), složka přeskočena,
  zaznamenána v terminálu i v sekci "Nečitelné" v reportu.

## Rozhodnutí během práce (kandidát na /mini:decision)
- **Mermaid jen nad složkami + limit 60 uzlů** (ořez se napíše do reportu). Zvážena
  a zamítnuta varianta "soubory jako uzly" kvůli nečitelnosti u velkých projektů.
- **Vyloučení vlastních výstupů ze scanu** přes regex `vibeanalyzer-*.{json,md}`,
  aby se příští běh nezapočítal do sebe.
- **Limit ořezu se zatím nedá nastavit z CLI** (napevno 60). Záměrně — konfigurace
  je non-goal v1.
- **Výchozí výstup je `~/.vibeanalyzer/<jméno projektu>/`** (ne CWD). Důvod: nešpiní
  analyzovaný projekt a nehrozí, že si nástroj příště započítá vlastní výstup.
  Past: dva různé projekty se stejným jménem složky sdílejí výstupní adresář
  (soubory se kvůli časovému razítku nepřepíšou, jen koexistují). Pro kořen `/`
  se použije jméno "root".

Pokud chceš ten "proč jen složky / proč regex na vlastní výstupy" zaznamenat jako
ADR, spusť `/mini:decision` před `/mini:done`. Jinak není nutné.

## Otevřené body / dluhy
- `npm install` hlásí zranitelnosti v dev závislostech (řetězec vitest/esbuild).
  Netýká se runtime kódu nástroje; patří spíš do pozdější bezpečnostní fáze.
- Seznam souborů v MD je plochý a u velkých projektů dlouhý — vědomě, JSON je
  ten strojový zdroj pravdy. Hezčí stromové zobrazení je možná pozdější vylepšení.
