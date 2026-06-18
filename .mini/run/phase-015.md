---
phase: 15
verdict: done
steps:
  - title: "Modul limitů: paměťový strop + timeout"
    status: done
  - title: "Child entry: běh analýzy + IPC výsledek"
    status: done
  - title: "Rodičovský harness: fork, limit, rozliš pád"
    status: done
  - title: "Napojit obě vrstvy v cli.ts přes harness"
    status: done
  - title: "Testy: OOM / timeout / bug / happy-path"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
---

# Phase 15 — report z auto session

## Co se udělalo

Nález 13-3 vyřešen: reálný běh tsc i ESLint se přesunul do IZOLOVANÉHO podprocesu
(`child_process.fork`) s limitem paměti a časovým limitem. OOM/zaseknutí teď shodí
jen podproces, ne celý nástroj → success criterion „report bez pádu" drží i na
obřím projektu.

Nové moduly:
- `src/analyze/limits.ts` – `computeMemoryLimitMb` (z dostupné paměti přes
  `process.availableMemory()`, fallback `os.freemem()`, ~70 %, clamp podlaha 1024 MB
  / strop 8192 MB) + `ANALYSIS_TIMEOUT_MS` (120 s).
- `src/analyze/runIsolated.ts` – rodičovský harness: fork, relay „started",
  rozlišení OOM / timeout / obecný pád, úklid (SIGKILL + clearTimeout, žádný zombie).
- `src/analyze/analyzeChild.ts` – forkovaný child entry: spustí náš analyzátor,
  pošle výsledek přes IPC. (Běží NÁŠ kód, ne kód projektu – non-goal č. 1 dodržen.)
- `src/cli.ts` – `shouldIsolate()`, `childExecArgv()`, `skipFromOutcome()` (mapuje
  příčinu pádu na PRAVDIVÝ skip důvod) a izolované obaly obou vrstev.

Tři odlišné skip důvody (žádný nelže): OOM → „příliš velký projekt (limit X MB)",
timeout → „trvalo příliš dlouho (limit N s)", obecný pád → „selhal (viz stderr)".

## Co je ověřené (mnou, mechanicky)

- **Reálný produkční běh z `dist`** (fork, bez tsx, bez env override): forkne obě
  vrstvy, progres relayuje z dětí, nálezy se vrátí přes IPC správně (tsc TS2322 +
  eslint eqeqeq/no-empty na správných řádcích), exit 0.
- **Fork integrace MÁ zuby:** rozbil jsem `CHILD_PATH` → oba cli e2e testy spadly
  (`kind` z „ran" na „skipped"), pád dítěte čistě degradoval za 481 ms (žádný hang).
- **Rozlišení OOM/timeout/crash má zuby:** rozbil jsem `looksLikeOom` → OOM test
  spadl (přepnul na „crashed"). Tři příčiny → tři odlišné důvody (test).
- **Harness:** OOM (alokace + `--max-old-space-size=64`), timeout (zaseknuté dítě),
  obecný pád (exit 1), fork-fail (neexistující skript) – každá větev testem.
- Celá suite **227/227**, `tsc` build čistý.

## Adversariální review (nezávislý sub-agent, čerstvý kontext)

- **SK-1 (fork integrace prý bez testu) – VYVRÁCENO** empiricky: sub-agent si špatně
  přečetl test soubory. cli.tsc/eslint mají kromě injektovaných testů i NO-DEPS e2e,
  které forkují přes `analyzeChild` a serializují reálné typy přes IPC; teeth test
  (rozbití CHILD_PATH) to potvrdil.
- **SK-2 (timeout test 400 ms těsný) – OPRAVENO:** zvednut na 1200 ms.
- **N-1 (`availableMemoryBytes` netestovaný, vč. fallbacku) – OPRAVENO:** přidán test
  obou větví (s `process.availableMemory` i bez něj).
- **N-4 (tichá ztráta ochrany při `VIBE_ANALYSIS_INPROCESS=1`) – ZVÁŽENO, NEPŘIDÁNO:**
  varování na stderr by rozbilo kontrakt „úspěch = ticho na stderr" v cli.scanfail
  testech (které ten ventil nastavují kvůli rychlosti). Ventil je interní/debug seam
  dokumentovaný jen v kódu, ne uživatelská funkce → riziko „omylem zapnu" je nízké.

## Na co upozornit (rozhodnutí pro člověka)

**1) Každý běh teď FORKUJE** (i u malého projektu): fork node + načtení typescriptu
přidá ~1–2 s režie na každý běh, i když projekt nikdy nehrozil OOM. Je to cena za
reálnou záruku „bez pádu" (zvolená alternativa proti heuristickému stropu na počet
souborů, který nezaručí nic). Pokud ti ta režie u malých projektů vadí, je to bod
k přehodnocení – doporučuju zaznamenat „proč vždy izolujeme" přes `/mini:decision`.

**2) Testovací seam `VIBE_ANALYSIS_INPROCESS=1`:** přidán do `cli.ts`, aby cli testy,
které NEcílí izolaci (gitignore, outDir, intent, writefail…), běžely in-process –
jinak by každý `run()` forkoval a paralelně se dusil (suita zpomalila ze ~14 s na
130 s+ a kaskádovitě timeoutovala). Default (bez env) = izolace. Je to kompromis,
ne čistě „feature".

**3) Suita zpomalila** z ~14 s na ~37 s kvůli 2 e2e testům, které reálně forkují
(tsx + cold load typescriptu, ~6 s každý). Vědomé: chtěl jsem reálnou fork cestu
mít pod testem se zuby, ne jen in-process.

## Otevřené / mimo rozsah

13-2 (loadTypescript načítá projektový typescript) zůstává samostatný otevřený nález.
