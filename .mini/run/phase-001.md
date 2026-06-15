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
