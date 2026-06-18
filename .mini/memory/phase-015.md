# Phase 15 — Ochrana strojové vrstvy proti pádu

**Goal:** Zajistit, aby strojová vrstva (tsc + ESLint) na velmi velkém projektu místo tichého OOM/pádu čistě degradovala na 'přeskočeno: příliš velký projekt' (konkrétní mechanismus – oddělený proces s limitem paměti vs. strop na počet souborů – rozhodne discuss); ověřeno tím, že na extrémním vstupu nástroj dorobí report bez pádu.

## Steps
- [done] Modul limitů: paměťový strop + timeout
- [done] Child entry: běh analýzy + IPC výsledek
- [done] Rodičovský harness: fork, limit, rozliš pád
- [done] Napojit obě vrstvy v cli.ts přes harness
- [done] Testy: OOM / timeout / bug / happy-path
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 15: Ochrana strojové vrstvy proti pádu

## Discussion
# Phase 15 — Ochrana strojové vrstvy proti pádu

## Intent
Nález 13-3: tsc i ESLint dnes běží v NAŠEM procesu (tsc `tsc.ts:81` createProgram;
eslint `eslint.ts:41` lintFiles), obaleno try/catch v `cli.ts:191–227`. Jenže OOM
ani zamrznutí žádný try/catch nechytí – V8 při OOM zabije celý proces a žádný report
nevznikne → porušení success criteria „report bez pádu".

Cíl: tsc i ESLint pustit v IZOLOVANÉM PODPROCESU s limitem paměti A časovým limitem.
Když dítě překročí, spadne/zabije se jen ono a rodič to ČISTĚ ohlásí jako přeskočenou
vrstvu s konkrétním důvodem (velikost / čas). Plné pokrytí zůstává: podproces vždy
zkusí celý projekt, přeskočí se jen když to reálně nejde (žádné krájení – tsc je
celoprogramový, krájet nejde; žádné tiché zahození části).

## Key decisions
- **Mechanismus = oddělený proces** (uživatel zvolil reálnou záruku, ne levný strop).
  Doporučení: `child_process.fork` (skutečná OS-procesní izolace paměti – rodič přežije
  i nativní OOM dítěte). `worker_threads` je lehčí, ale sdílí paměť procesu → proti
  nativnímu OOM nechrání plně. Dítě IMPORTUJE naše moduly (analyzeTypeScript /
  analyzeESLint) a samo je spustí; rodič posílá jen prostá data (root, files) a zpět
  dostává diskriminovaný výsledek (kind/reason/findings/fileCount) přes IPC.
- **Rozsah = OBĚ vrstvy** (tsc i ESLint). Pořadí práce: nejdřív rozchodit harness na
  tsc, ESLint pak stejný harness jen zopakuje.
- **Limit paměti = dynamicky z DOSTUPNÉ paměti.** Použít `process.availableMemory()`
  (Node 22+; ověřeno na v24.14.1, respektuje cgroup), fallback `os.freemem()`. Vzít
  50–75 % (default cca 70 %) jako `--max-old-space-size=<MB>` dítěte. POVINNĚ ošetřit:
  spodní podlaha (min ~1024 MB, ať na vytíženém stroji neskipujeme i malé projekty)
  + rozumný strop nahoře (ať dítě nenafoukne na desítky GB a neudusí hostitele).
- **Timeout = ano, v této fázi.** Rodič po N sekundách dítě zabije → vrstva přeskočena
  s důvodem „analýza trvala příliš dlouho (časový limit Ns)". Default N zvolit v plánu
  (doporučení: štědrých ~120 s; legitimní velký projekt chvíli trvá).
- **Tři ODLIŠNÉ důvody přeskočení, žádný nesmí lhát:**
  1. OOM (dítě umřelo na heap-OOM: exit 134 / stderr „heap out of memory" / u workeru
     ERR_WORKER_OUT_OF_MEMORY) → „přeskočeno: příliš velký projekt (limit X MB paměti)".
  2. Timeout (zabití inicioval rodič) → „přeskočeno: analýza trvala příliš dlouho (Ns)".
  3. Obecný pád (bug v našem kódu) → „přeskočeno: analýza selhala (viz stderr)" + vypsat
     stack/stderr dítěte. NEtvrdit velikost/čas.
- **Report uvádí konkrétní limit** (MB paměti + timeout s) u přeskočené vrstvy – běh je
  kvůli „podle dostupné paměti" NEDETERMINISTICKÝ (jiný stroj/zátěž = jiný výsledek),
  takže uživatel musí vidět, proč se přeskočilo.

## Watch out for
- **Tři stavy musí držet:** ran / „ran s 0 nálezy" (čistý) / skipped se nesmí slít
  (tichý falešný úspěch). Nové skip důvody nesmí kolidovat se stávajícími (chybí
  tsconfig, žádné JS/TS soubory, …).
- **Rozlišení OOM vs timeout vs bug** je nejtěžší část – na něm stojí, že důvod nelže.
  Timeout poznáme tím, že kill inicioval rodič; OOM podle exit kódu/stderr signatury;
  zbytek = obecný pád. Otestovat každou větev zvlášť.
- **`--max-old-space-size` limituje jen V8 old space**, ne nativní alokace. Proto fork
  (separátní OS proces) – i kdyby nativní alokace zabila dítě, rodič žije a dorobí report.
- **OOM/timeout NEJDE věrně vyrobit v CI.** Ověření = vstříknout uměle NÍZKÝ paměťový
  limit a KRÁTKÝ timeout (přes dep injection / env) a na malém vstupu deterministicky
  trefit každou větev; assertovat přesný text důvodu. + happy-path test, že podproces
  vrátí TYTÉŽ nálezy jako dnešní in-process běh. + test, že obecný pád dítěte dá
  „selhala (viz stderr)", ne lživé „příliš velký". Testy musí mít zuby.
- **`process.availableMemory()` je Node 22+.** Ověřit `engines` v package.json; když
  dovoluje níž, fallback na `os.freemem()` (pozor: freemem na Linuxu hlásí míň, než je
  reálně dostupné – počítat radši z availableMemory, když je).
- **onStart progress** („Spouštím tsc/ESLint nad N souborů", `cli.ts:193,218`) dnes
  vzniká uvnitř analyzátoru. Po přesunu do dítěte ho musí rodič buď spočítat před forkem,
  nebo relayovat z dítěte zprávou „started" – tu hlášku neztratit.
- **IPC serializace:** výsledky jsou prostý JSON (diskriminované unie, Finding[]) → přes
  IPC/structured clone OK. NEposílat funkce (onStart) do dítěte.
- **Stávající try/catch v `cli.ts`** nechat jako pojistku pro chyby na straně rodiče.
- **Non-goal č. 1 nedotčen:** v dítěti běží NÁŠ kód, ne kód projektu – izolace nezavádí
  spouštění cílového kódu. (Otevřený nález 13-2 o tom, že tsc načítá projektový
  typescript, je samostatný a do této fáze NEpatří.)
- **Rozsah:** tohle je plná fáze na horní hranici 1–3 dnů (podproces + IPC + tři větve
  selhání + testy). Nehromadit do ní nic navíc.

## Run report
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
