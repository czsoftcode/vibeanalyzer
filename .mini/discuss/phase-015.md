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
