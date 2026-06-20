# Phase 40 — Dokončit tři adversarial nity

**Goal:** Sjednotit escapeLabel na přísnost escapeNodeLabel, ošetřit kolizi časového razítka tak, aby nepřepsala dřívější výstup, a u DT_UNKNOWN souborů reuse velikosti z lstat místo druhého stat.

## Steps
- [done] Zpřísnit escapeLabel jako escapeNodeLabel (1-4)
- [done] Reuse velikosti z lstat u DT_UNKNOWN (2-11)
- [done] Kolize razítka nepřepíše dřívější výstup (1-5)
- [done] Doběh: tsc + celá suite zelené
- [done] Nezávislý adversarial self-review trojice

## Auto-commit
- Phase 40: Dokončit tři adversarial nity

## Run report
---
phase: 40
verdict: done
steps:
  - title: "Zpřísnit escapeLabel jako escapeNodeLabel (1-4)"
    status: done
  - title: "Reuse velikosti z lstat u DT_UNKNOWN (2-11)"
    status: done
  - title: "Kolize razítka nepřepíše dřívější výstup (1-5)"
    status: done
  - title: "Doběh: tsc + celá suite zelené"
    status: done
  - title: "Nezávislý adversarial self-review trojice"
    status: done
---

# Phase 40 — report z auto session

Tři adversarial nity (1-4, 1-5, 2-11) dokončené. tsc čistý, celá suite zelená (47 souborů / 395 testů).

## Co se udělalo

**1-4 — escapeLabel (`src/report/markdown.ts`).** Dvě funkce `escapeLabel` (volnější, jen `"`/`[]`) a `escapeNodeLabel` (přísnější) jsem sloučil do jedné přísné `escapeLabel`: CR/LF→mezera, `"`→`'`, maže `[ ] ` ` ;`. Používá ji strom struktury (`buildFolderDiagram`) i graf modulů (`buildModuleDiagram`). `escapeNodeLabel` zmizela, poslední volání přepsáno. Důvod: nekonzistence byla zbytečná, jméno složky je stejně cizí vstup jako cesta souboru.

**2-11 — dvojí stat (`src/scan.ts`).** U DT_UNKNOWN entry (FS bez d_type), kde `lstat` určí soubor, se teď velikost bere z `lstat` (`knownSize`) a druhý `stat` se přeskočí. U běžné d_type cesty zůstává `knownSize` undefined → velikost dořeší `stat` jako dřív. Odpadl jeden syscall i druhá chybová cesta (stat→skippedUnreadable po prošlém lstatu).

**1-5 — kolize razítka (`src/report/outputPaths.ts` nový + `src/cli.ts`).** Dva běhy ve stejné ms dají stejný stamp a `rename` cíl tiše přepíše → druhý report by smazal první. Nový `resolveOutputPaths(outDir, stamp, exists?)` hledá volnou dvojici `vibeanalyzer-<stamp>[-N].{json,md}` (sufix -1, -2…), dvojici drží pohromadě (stejný sufix pro .json i .md). Po `maxAttempts` hodí (žádný tichý přepis ani zacyklení). Voláno v cli.ts PŘED `mkdir` → případný throw probublá dřív, než cokoli vznikne (invariant 3-9 „žádný osiřelý adresář" drží).

## Teeth ověřené mutací

Dočasně jsem rozbil každý fix a pustil dotčené testy → spadlo 5 testů (markdown injection, scan size, tři kolizní v outputPaths). Po revertu zase zeleno. Testy netestují kopii, ale reálný kód.

## Nezávislý self-review (čerstvý sub-agent)

Bez blockeru a bez major. Potvrdil: `escapeNodeLabel` už nikdo nevolá; `knownSize` korektní ve všech větvích; sufix-větev dosažitelná; žádný leftover; dvojice .json/.md drží pohromadě. Jeden nit u `escapeLabel`: `#` v labelu přežívá a Mermaid HTML entity (`#kód;`) jsou neutralizované jen jako VEDLEJŠÍ efekt mazání `;`. `#` jsem do escapu nepřidal (zmrzačilo by legitimní názvy jako `C#`), ale doplnil jsem do komentáře explicitní varování, ať někdo `;` nevrátí a nepropustí tím entity.

## Vědomě přijaté meze (zmíněné v kódu)

- **TOCTOU** mezi kontrolou existence a `rename` v `resolveOutputPaths`: jiný souběžný proces může mezi tím stejný název vytvořit. U lokálního jednouživatelského CLI přijatelné; plné řešení (`O_EXCL`) je neslučitelné s atomickým temp+rename zápisem. Okno je mikrosekundy a vyžaduje druhý souběžný běh.
- **`fsExists` mapuje JAKOUKOLI chybu `access` na false** (i EACCES). Důsledek: při nečitelné cílové cestě se prohlásí za „volnou" a chyba se ukáže až u zápisu (return 1, ne tichý přepis). Méně přesná diagnostika, ne ztráta dat.

## Pozn. pro člověka

Nic vizuálního k ověření – vše ověřitelné mechanicky (tsc + testy) jsem ověřil sám. Tři nálezy 1-4, 1-5, 2-11 zůstávají formálně otevřené v review seznamu, dokud je nezavřeš přes `mini done`.
