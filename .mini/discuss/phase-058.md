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
