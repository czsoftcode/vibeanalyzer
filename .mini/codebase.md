# VibeAnalyzer — code overview

## Overview
Lokální CLI nástroj (TypeScript, ESM, Node ≥20), který **čte – nespouští** zadanou složku a generuje strukturální index projektu. Aktuální stav (fáze 1–3): strojová vrstva — projde strom souborů a vypíše dva výstupy: JSON index (`vibeanalyzer-<timestamp>.json`) a lidský MD report s Mermaid diagramem složek (`vibeanalyzer-<timestamp>.md`). AI vrstva (Claude API), bezpečnostní/logická analýza a non-goaly z `project.md` zatím NEjsou implementované — je to teprve kostra.

## Directory structure
- `src/` — veškerý zdrojový kód (TS), vč. `*.test.ts` (Vitest)
- `src/report/` — sestavení a zápis výstupů (JSON index, Markdown, zápis na disk)
- `dist/` — build výstup (`tsc`), ignorovat
- `.mini/` — orchestrace projektu (vize, fáze, tento soubor)
- `node_modules/`, `.git/` — ignorovat

## Key modules
- `src/bin.ts` — spustitelný vstup (`bin` v package.json); volá `run()`, mapuje výsledek/chybu na `process.exitCode`. Bez detekce entrypointu (záměrně).
- `src/cli.ts` — `run(argv, cwd)`: orchestrace celého běhu (parse args → validace cíle → scan → build JSON+MD → mkdir+zápis). Drží nápovědu (HELP) a exit kódy (0 ok, 1 runtime chyba, 2 chyba argumentů). Pečlivý úklid osiřelých adresářů/souborů při selhání.
- `src/args.ts` — `parseArgs` (čistá, bez I/O), `validateTarget` (stat/access cíle), `defaultOutDir` (`~/.vibeanalyzer/<jméno>`). Typ `ParsedArgs` (help/version/run/error).
- `src/scan.ts` — `scanTree(root, options)`: defenzivní průchod stromem do plochého `FileEntry[]`. Nesleduje symlinky, přeskakuje `node_modules/.git/.mini/dist/build` a vlastní výstupní artefakty. I/O chyby → `skippedUnreadable` (nehází). Konstanta `ROOT_UNREADABLE_MARKER = "."` (sdílený kontrakt s cli.ts: nepřečtený kořen vs. prázdný projekt).
- `src/report/jsonIndex.ts` — `buildJsonIndex`: model `JsonIndex` (version, generatedAt, root, files). `INDEX_VERSION = 1`.
- `src/report/markdown.ts` — `buildMarkdown` + `buildFolderDiagram`: MD report a Mermaid `graph TD` jen nad složkami, s ořezem na `DEFAULT_MAX_DIAGRAM_NODES = 60`.
- `src/report/writeOutputs.ts` — `writeReportFiles`: zápis páru JSON+MD; při chybě best-effort smaže obě cesty (soubory vznikají už při open).
- `src/version.ts` — `readPackageVersion`: čte verzi z package.json vedle balíčku, fallback "0.0.0".
- `src/timestamp.ts` — `fileTimestamp`: ISO čas bezpečný pro názvy souborů (`:` a `.` → `-`).

## Technologies
- Jazyk: TypeScript 5.6, ESM (`"type": "module"`, `module/moduleResolution: NodeNext`), target ES2022, `strict` + `noUncheckedIndexedAccess`.
- Runtime: Node ≥20, jen standardní `node:` moduly (žádné runtime závislosti).
- Build: `tsc` (`build`), dev přes `tsx` (`dev`).
- Testy: Vitest (`test`, `*.test.ts` v `src/`, vyloučené z buildu).
- Skripty: `build`, `dev`, `start`, `test`, `typecheck`.
