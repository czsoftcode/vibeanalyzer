---
phase: 6
verdict: done
steps:
  - title: "Přidat závislost ignore"
    status: done
  - title: "Funkce loadGitignore(root) + testy"
    status: done
  - title: "Rozšířit ScanOptions a ScanResult"
    status: done
  - title: "Napojit v cli.ts + stderr hlášky"
    status: done
  - title: "End-to-end test nad fixturem"
    status: done
  - title: "Sebekontrola + typecheck + nezávislý sub-agent"
    status: done
---

# Phase 6 — report z auto session

## Co fáze přidala
Skener teď kromě pevného `DEFAULT_SKIP_DIRS` respektuje i **kořenový `.gitignore`**.
Co Git ignoruje (u Symfony `vendor/`, `var/cache/` …) se z indexu vynechá – a u
ignorovaných adresářů se do nich **vůbec nevstoupí** (prořezání podstromu), takže
se neprochází desetitisíce souborů ve `vendor/`.

## Jak je to poskládané
- `src/gitignore.ts` (nový): `loadGitignore(root)` přečte `<root>/.gitignore` a vrátí
  třístavový výsledek (`loaded` s predikátem / `absent` / `unreadable`) – stejný vzor
  jako `loadIntent`. Predikát staví nad reálnou knihovnou `ignore`; pro adresář předává
  cestu s koncovým `/` (knihovna nedělá `fs.stat`, typ jí musíme dodat my).
- `src/scan.ts`: `ScanOptions.isIgnored?` (predikát) + `ScanResult.ignoredByGitignore`
  (počet vynechaných položek). scanTree predikát aplikuje, kořen (`rel=""`) mu nikdy
  neposílá. DEFAULT_SKIP_DIRS zůstal jako záchranná síť.
- `src/cli.ts`: napojení – nečitelný `.gitignore` → upozornění na stderr a scan poběží
  bez něj; chybějící → ticho; když `.gitignore` odfiltruje úplně vše (prázdný index,
  ale `ignoredByGitignore > 0`) → upozornění na stderr, report se přesto vyrobí (exit 0).

## Rozhodnutí (dle diskuse)
- **Knihovna `ignore` (první runtime závislost projektu).** `ignore@7.0.5` má NULA
  tranzitivních závislostí. Audit hlásí zranitelnosti, ale ty jsou z `vitest`/`vite`/
  `esbuild` (devDependencies, předchází této fázi), ne z `ignore`.
- **Prázdný výsledek po filtraci → varování na stderr**, ne tichý prázdný report.

## Testy (99 zelených celkem, +21 v této fázi)
- `gitignore.test.ts` (8): kontrakt s **reálnou** knihovnou – dir-only `vendor/` zabere
  jen s koncovým `/`, negace `!`, vnořené cesty, `*`, kořen, unhappy path
  (chybějící/prázdný/jen bílé znaky/nečitelný adresář).
- `scan.test.ts` (+4): prořezání podstromu, vynechání souboru, predikát se nevolá na
  kořeni, ignorované ≠ skippedUnreadable, bez predikátu `ignoredByGitignore === 0`.
- `cli.gitignore.test.ts` (5): e2e – `vendor/`+`var/cache/` zmizí a zbytek zůstane;
  bez `.gitignore` výstup beze změny; `*` → prázdný report + varování; nečitelný
  `.gitignore` → degradace nahlas; **read-only kontrakt** (běh s `--out` mimo projekt
  nezapíše nic do analyzovaného stromu).
- Zuby ověřeny mutací: odstranění `continue` u prořezávání shodilo 3 testy.

## Self-review (nezávislý sub-agent, čerstvý kontext)
Žádný must-fix. Jádro (prořezání korektní vůči Gitu, dir-only vzory, negace pod
ignorovaným rodičem, exit kódy, read-only) ověřeno proti reálné knihovně, ne mocku.
Jediný oprávněný should-know – chyběl test read-only kontraktu vůči analyzovanému
stromu – byl **doplněn** (test „READ-ONLY: běh nezapíše nic do projektu"). Zbylé
poznámky jsou nity konzistentní se stávajícím stylem (`code` mísí errno a český text
jako v `intent.ts`; `allowRelativePaths` chrání před tvarem cesty, který tok
negeneruje – ponecháno jako defenzivní pojistka, scanTree nesmí házet).

## Adversarial review – 3 nálezy opraveny (6-1 až 6-3)
Po prvním reportu proběhl `mini adversarial` a našel 3 platné nálezy, všechny opraveny
ještě před `mini done`:

- **6-1 (should-know): patologický `.gitignore` shodil celou analýzu.** Reprodukováno:
  řádka ~50 000 znaků projde `ignore.add()` (líná kompilace), ale první `ig.ignores()`
  hodí `SyntaxError` (V8 limit velikosti regexu). Predikát to nechytal → `scanTree`
  promise rejectoval → `cli.ts` (záměrně bez try/catch kolem scanTree) propadl do
  `bin.ts` → pád místo slíbené degradace. Moje původní obrana `allowRelativePaths` byla
  neúplná (řeší jen validaci cesty, ne kompilaci regexu). **Oprava:** strop
  `MAX_GITIGNORE_LINE = 4096` v `loadGitignore` – patologicky dlouhou řádku odmítne jako
  `invalid` JEŠTĚ PŘED kompilací (rychlá, deterministická degradace; měřením V8 hodí až
  po 1,5–5,5 s, takže pouhý try/catch by zaseknul scan na vteřiny). `cli.ts` na `invalid`
  varuje na stderr a scan poběží bez `.gitignore`.
- **6-2 (should-know): doc komentář `ignoredByGitignore` lhal** ("kolik položek se
  vynechalo" – prořezaný podstrom se přitom počítá jako 1). **Oprava:** komentář upřesněn
  (počet položek nejvyšší úrovně, prořezaný podstrom = 1; není to součet souborů).
- **6-3 (nit): varování o prázdném reportu nezaznělo u vzorů jen na soubory** (`*.php`
  smaže soubory, složky zůstanou → `files.length > 0`). **Oprava:** podmínka počítá
  `fileCount` (`type === 'file'`), ne `files.length`.

Zuby všech oprav ověřeny mutací (vypnutí stropu → padlý unit i e2e test, e2e navíc reálně
spadl na pomalém throwu). Celkem 103 testů zelených, suite ~3,5 s.

**Trade-off 6-1:** strop 4096 je heuristika – odmítne i legitimní (ale absurdně dlouhou)
řádku přes 4 KB. Reálné glob vzory mají desítky znaků, takže riziko falešného odmítnutí
je zanedbatelné a degradace je hlasitá. Sondu (`ignores()` při načtení) jsem nezvolil:
byla by pomalá a po stropu nedosažitelná (vadné krátké vzory `ignore` neháže).

## Mimo rozsah (dle zadání)
Vnořené `.gitignore` v podadresářích, `.git/info/exclude`, globální gitignore – pozdější
fáze.
