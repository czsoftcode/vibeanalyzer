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
