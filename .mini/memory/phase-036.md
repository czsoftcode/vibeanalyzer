# Phase 36 — Atomický zápis reportu přes rename

**Goal:** writeReportFiles zapíše JSON i MD do dočasných souborů a teprve po úspěchu obou je přejmenuje na cílová jména; při chybě uklízí jen tempy, takže selhání jednoho zápisu nezničí cílové soubory z minulého běhu (řeší 2-16 i 2-7), pokryto testy se zuby.

## Steps
- [done] Přepsat writeReportFiles na temp+rename
- [done] Test se zuby (2-7): cíl z minulého běhu přežije selhání
- [done] Test se zuby (2-16): pád MD nezničí cíl, žádný half-pár
- [done] Sladit existující testy s novou sémantikou
- [done] Doběh: tsc + celá test suite zelené

## Auto-commit
- Phase 36: Atomický zápis reportu přes rename

## Run report
---
phase: 36
verdict: done
steps:
  - title: "Přepsat writeReportFiles na temp+rename"
    status: done
  - title: "Test se zuby (2-7): cíl z minulého běhu přežije selhání"
    status: done
  - title: "Test se zuby (2-16): pád MD nezničí cíl, žádný half-pár"
    status: done
  - title: "Sladit existující testy s novou sémantikou"
    status: done
  - title: "Doběh: tsc + celá test suite zelené"
    status: done
---

# Phase 36 — report z auto session

## Co se udělalo
`writeReportFiles` (`src/report/writeOutputs.ts`) přepsán z přímého zápisu do cíle
na vzor **temp+rename**: JSON i MD se zapíšou do `<cíl>.tmp` ve stejném adresáři a
teprve po úspěchu OBOU se `rename`em přejmenují na cílová jména. Při chybě se
best-effort `unlink`ují jen tempy; cílové soubory se nedotknou. Tím selhání jednoho
zápisu nepřepíše ani nesmaže platný report z minulého běhu.

Aktualizován i komentář u volajícího (`src/cli.ts:423`), aby odpovídal nové
sémantice (úklid jen vlastních `.tmp`, ne částečně zapsaných cílů).

## Které nálezy to řeší
- **2-7** (úklid mazal cíl bezpodmínečně podle cesty, ne „co jsem vytvořil"): při
  selhání prvního zápisu se ke druhému cíli vůbec nedostaneme a starý report přežije.
- **2-16** (pár-atomicita ničila úspěšně zapsaný JSON při pádu MD): bez renamu se cíl
  nemění → žádný half-pár.

## Ověření (mechanicky, mnou)
- **Zuby testů**: dočasně jsem vrátil starou implementaci (přímý zápis + bezpodmínečný
  unlink cílů) → testy `2-7`, `2-16` i „EISDIR zbytkové okno" padly; po vrácení nové
  implementace všech 5 zelených. Druhá sabotáž (odebrání `unlink(jsonTmp)`) shodila
  testy na osiřelém `.tmp` → i úklidová větev má zuby.
- **tsc** (`npm run typecheck`): čistý.
- **Celá suite** (`npm test`): 45 souborů / 383 testů zelených, včetně
  `cli.writefail.test.ts` (cesta přes CLI).
- **Nezávislý sub-agent** (čerstvý kontext): potvrdil, že žádné pořadí selhání
  write1/write2/rename1/rename2 nezničí cizí cíl a že catch nikdy nemaže cizí cestu.

## Vědomě přijaté meze (v docstringu)
- **Zbytková neúplná atomicita**: dva renamy nejsou jeden krok. Když první (JSON)
  uspěje a druhý (MD) selže, zůstane nový JSON + starý/žádný MD; rollback nejde.
  Realistické pády (ENOSPC/EDQUOT/EFBIG/EIO) ale nastávají při zápisu tempu PŘED
  prvním renamem → okno je řádově menší než u přímého zápisu. Testem zdokumentováno.
- **Leftover `.tmp` při tvrdém killu** (SIGKILL mezi zápisem a renamem): žádný sweep
  neděláme – leftover je lepší než poškozený cíl.

## Drobnosti ze self-review (k zápisu do todo, ne blokery)
- **N1**: `writeReportFiles` nehlídá `jsonPath !== mdPath` (ani kolizi cíle s příponou
  `.tmp`). Dnešní volající to nikdy nespustí (časové razítko v názvu), proto jsem
  NEpřidával guard „pro budoucnost". Past pro případného budoucího volajícího.
- **N2**: v EISDIR zbytkovém okně `cli.ts` přes `rm(createdDir, {recursive})` smaže i
  nově přejmenovaný JSON. Jen když adresář vznikl v tomto běhu (do cizího outDir se
  nesahá), uživatel dostává exit 1. Konzistentní s invariantem „maž jen vytvořené" –
  přijatelné, jen stojí za vědomí.

## Poznámky pro člověka
Nic k vizuální/UX kontrole; vše ověřitelné mechanicky a ověřeno. Concurrency: pevný
suffix `.tmp` nezhoršuje předchozí stav (souběžné běhy by kolidovaly i na finálních
jménech, která nesou stejné razítko).
