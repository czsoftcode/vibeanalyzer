# Phase 58 — Dělič payloadu na části

**Goal:** Přidat čistou funkci, která AI kandidáty (stejný výběr jako collectAiPayload: zdrojová přípona, ne minifikát, pod per-file stropem) rozdělí do pole částí pod stropem – žádný zdrojový soubor se nerozsekne ani neztratí, deterministické pořadí – s testy se zuby; zatím bez napojení do AI volání (to přijde jako další fáze).

## Steps
- [done] Vytáhnout výběr kandidátů do sdílené funkce
- [done] Implementovat dělič s rovnoměrným dělením
- [done] Testy se zuby pro dělič
- [done] Zelený typecheck a testy
- [done] Nezávislý self-review sub-agentem

## Auto-commit
- Phase 58: Dělič payloadu na části

## Discussion
# Phase 58 — Dělič payloadu na části

## Intent
Připravit ZÁKLAD pro pozdější krájení velkých projektů na víc AI dotazů. Dnešní
`collectAiPayload` (src/analyze/aiPayload.ts) dělá výběr + slepení do JEDNOHO textu
pod globálním stropem `AI_PAYLOAD_CHAR_BUDGET` (1 650 000 znaků), zbytek uřízne a
přizná (`truncated`). Dělič vezme TÝŽ výběr, ale místo „slep jeden, zbytek zahoď"
udělá „rozděl do N částí, každá pod oknem, NIC nezahoď".

Tato fáze = jen čistá funkce + testy se zuby. ŽÁDNÉ napojení do AI volání, odhadu
ceny ani reportu (to jsou další fáze). Pozor: dočasně nenapojený kód — obhajitelné
jen proto, že hned navazuje fáze, co ho zapojí.

## Key decisions
- **Strategie = rovnoměrné dělení, NE „plň po strop".** Spočítat
  `N = ceil(celkováVelikostVybraných / okno)` a rozdělit soubory do N zhruba
  stejně velkých částí (greedy s cílem `total/N`). Důvod: vyrovnané části, žádná
  nevisí těsně pod stropem; konzistentnější kvalita napříč částmi.
- **Okno = PARAMETR funkce, ne natvrdo konstanta.** Konkrétní hodnotu (kompromis
  kvalita vs. cena) řeší až fáze napojení. Z okna se počítá N. Testy můžou zkoušet
  libovolné okno.
- **Okno je TVRDÁ horní mez, rovnoměrnost je MĚKKÝ cíl.** Když cíl `total/N` a okno
  kolidují (zrnitost souborů), vyhrává okno — žádná část ho nesmí přesáhnout, jinak
  by API vstup uřízlo.
- **Krájet po CELÝCH souborech** — soubor se nikdy nerozsekne. Per-file strop
  (100 kB) << okno, takže soubor se vždy vejde; rozseknutí by rozbilo číslování
  řádků = obrana proti halucinaci (kontrola `lineCount` v toFindings).
- **Výběr kandidátů VYTÁHNOUT do sdílené funkce** používané `collectAiPayload`
  i děličem (jeden zdroj pravdy proti driftu). Výběr = `type==="file"` && ne
  minifikát && `SOURCE_EXTENSIONS.includes(ext)` && `size <= AI_PAYLOAD_PER_FILE_MAX_BYTES`,
  řazení `path.localeCompare` (deterministické). Refaktor `collectAiPayload` se
  dotkne jeho stávajících testů — počítat s tím.
- **Oversized soubory** (> per-file strop) se do částí NEzahrnují, vrací se zvlášť
  (globálně napříč částmi), aby je report přiznal — stejně jako dnes.
- **Přetékající soubor dostane vlastní (přeplněnou) část.** Soubor, co prošel
  per-file výběrem, se VŽDY zahrne; když se sám nevejde ani do prázdné části
  (okno < velikost souboru — reálně nenastane s dnešními konstantami, ale v
  testu/budoucnu ano), dostane vlastní část, i když ji přeteče. Kopíruje dnešní
  chování collectAiPayload („první se zahrne vždy"). NEhází se do oversized
  (to je vyhrazené pro „nad per-file stropem" — nemíchat dva důvody vynechání).

## Watch out for
- **Tvar výstupu (návrh, doladit v plan):** pole částí, každá `{ text, includedFiles: PayloadFile[] }`
  (lineCount per soubor kvůli kontrole místa proti halucinaci) + globální
  `oversizedFiles: string[]`. `truncated`/`omittedFiles`/`omittedBytes` u děliče
  nedávají smysl (nic se neuřízne — to je celý point), nemíchat je sem.
- **N počítat z velikosti PO výběru** (jen zahrnuté soubory, BEZ oversized), ne
  z celkové velikosti scanu.
- **Determinismus** je kontrakt: stejný vstup → stejné rozdělení (řazení podle
  cesty, greedy). Test to musí ověřit.
- **Prázdný vstup / žádní kandidáti** → prázdné pole částí, prázdné oversized, bez
  pádu. Edge.
- **Testy se zuby (ne happy-path):** malé okno → víc částí; součet souborů napříč
  VŠEMI částmi == všichni vybraní kandidáti (nic se neztratí, nic se nezdvojí);
  žádná část nepřekročí okno (kromě single-file přeplněné části); oversized se do
  částí nedostanou; prázdný vstup.
- **Sdílený výběr = cross-module kontrakt.** Po extrakci musí test ověřovat REÁLNOU
  sdílenou funkci, ne kopii literálu. Riziko, že refaktor collectAiPayload tiše
  změní jeho chování — projet jeho stávající testy.
- **Inherentní cena krájení (mimo tuto fázi, ale ví se):** soubory ve dvou různých
  částech AI nevidí naráz → logická/non-goal analýza napříč moduly se zhorší. Report
  to bude muset přiznat (pozdější fáze). Náklad = modeCount × početČástí volání.

## Run report
---
phase: 58
verdict: done
steps:
  - title: "Vytáhnout výběr kandidátů do sdílené funkce"
    status: done
  - title: "Implementovat dělič s rovnoměrným dělením"
    status: done
  - title: "Testy se zuby pro dělič"
    status: done
  - title: "Zelený typecheck a testy"
    status: done
  - title: "Nezávislý self-review sub-agentem"
    status: done
---

# Phase 58 — report z auto session

## Co je hotové
Přidán **dělič payloadu na části** jako čistá funkce, zatím BEZ napojení do AI volání
(to je další fáze). Vše v `src/analyze/aiPayload.ts`:

- **`selectAiCandidates(files)`** – vytažený sdílený výběr AI kandidátů
  (`type==="file"` && ne minifikát && zdrojová přípona && `size <= AI_PAYLOAD_PER_FILE_MAX_BYTES`,
  řazení `path.localeCompare`) + oversized zvlášť. `collectAiPayload` ho teď používá
  místo inline filtru → **jeden zdroj pravdy** proti driftu mezi single-shotem a krájením.
  Chování `collectAiPayload` beze změny (jeho stávající testy procházejí).
- **`formatFileChunk(path, content)`** – vytažený sdílený formát bloku (hlavička cesty),
  aby `collectAiPayload` i `splitAiPayload` slepovaly identicky.
- **`splitAiPayload(files, readFile, window)`** → `{ chunks: { text, includedFiles }[], oversizedFiles }`.
  Rovnoměrné dělení: `N = ceil(total / window)` z délky VE ZNACÍCH, cíl `total/N`,
  okno je TVRDÁ horní mez, rovnoměrnost MĚKKÝ cíl (nikdy nevyrobí víc částí než N),
  krájení po celých souborech, přetékající soubor dostane vlastní část, `window<=0` →
  `RangeError`.

Pozn. k signatuře: dělič bere `files` (ne předem vybrané `selected` jako naznačoval
plán) a výběr volá sám – symetrie s `collectAiPayload` a `oversizedFiles` vrací
konzistentně. Drobná odchylka od doslovného názvu parametru v plánu, beze změny záměru.

## Testy
Nový soubor `src/analyze/aiPayload.split.test.ts` (16 testů). Ne happy-path: malé okno →
víc částí; rovnoměrné [4,4] místo [6,2]; součet souborů == kandidáti (nic neztraceno/
nezdvojeno); žádná část nepřekročí okno (kromě single-file přeplněné); přetékající soubor;
oversized mimo části; prázdný vstup; samé ne-kandidáty; determinismus; lineCount;
`window` 0/-5/NaN/Infinity → RangeError. Délky bloků se NEhádají z formátu hlavičky
(riziko kopie literálu) – měří se přes split s obřím oknem.

Celá sada: **640 → 641 testů zelených** (58 souborů), typecheck čistý.

## Adversarial review (nezávislý sub-agent, čerstvý kontext)
Sub-agent ověřil algoritmus brute-force fuzzingem (~1,2M vstupů) + mutačním testováním.
Verdikt: algoritmus matematicky i empiricky korektní (okno = tvrdá mez, ≤ N částí od
měkkého cíle, nic se nezahodí), cross-module kontrakt drží, edge cases ošetřené, znaky-vs-
bajty je vědomá konzistentní volba.

**Jediný reálný nález [STŘEDNÍ]: díra v testech** – nejdůležitější invariant fáze
(ochrana `moreChunksNeeded`, ať měkký cíl nevyrobí víc částí než N) nebyl pokrytý
testem se zuby; mutace `moreChunksNeeded = true` procházela zeleně. **Opraveno**:
přidán test s nerovnoměrnými bloky (poměr ~[12,19,59,12]); ověřeno, že s mutací padá
a po vrácení ochrany prochází (proto 641, ne 640).

Drobnost mimo rozsah fáze: `localeCompare` je locale-závislý (ne bytewise) – sdílené
chování s `collectAiPayload`, neřešeno zde.

## Známá omezení (mimo tuto fázi, pro pozdější fáze)
- Dělič je zatím NENAPOJENÝ – `collectAiPayload` se pořád používá v `cli.ts`. Napojení
  (víc API volání per část), sloučení nálezů a odhad ceny pro N částí jsou další fáze.
- Inherentní cena krájení: soubory ve dvou částech AI nevidí naráz → logická/non-goal
  analýza napříč moduly se zhorší; report to bude muset přiznat (pozdější fáze).
  Náklad = `modeCount × početČástí` volání.
