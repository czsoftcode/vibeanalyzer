# Phase 34 — Triáž a úklid otevřených nálezů

## Intent
Projít 22 otevřených review nálezů (1-4 až 3-15) a zjistit, které už byly
vyřešeny pozdějšími fázemi. Vyřešené uzavřít přes `mini findings resolve <id>
--reason <…>`, zbylé nechat otevřené. Cílem je, aby `mini findings list`
neobsahoval falešně otevřené (= už opravené) nálezy — ne aby byl seznam za
každou cenu krátký.

Důvod nutnosti re-evaluace: nálezy 3-x pocházejí z commitu `483e482`, od kterého
je 31 commitů; `cli.ts` byl přepsán, přibyl `cliMain.ts`, `isEntrypoint` už v
`cli.ts` není. **Čísla řádků v nálezech jsou neplatná** — posuzovat podle
chování, ne podle řádku.

## Key decisions
- **Striktně jen triáž — žádný nový produkční kód.** Reálné nálezy se NEopravují
  v této fázi; opraví se jako vlastní pozdější fáze (lze založit z `--from-finding`).
- **Reálné, ale neopravené nity zůstávají OTEVŘENÉ** (poctivý backlog). Neuzavírat
  je jako „wontfix". Uzavírají se jen prokazatelně opravené nálezy.
- **Kritérium uzavření (přísné):** uzavřít jen když existuje konkrétní kód NEBO
  test, který nález prokazatelně řeší. `--reason` musí odkazovat na to místo
  (soubor:řádek nebo název testu).

## Watch out for
- Neuzavírat nález jen proto, že se posunul řádek nebo přibyl podobně pojmenovaný
  test. Bug může žít dál na novém řádku.
- Test bez „zubů" (pokrývá jen happy path nálezu, neověřuje selhání, které nález
  popisuje) NEstačí na uzavření → nález zůstává otevřený.
- Nálezy 2-15, 3-12, 3-13 jsou o CHYBĚJÍCÍCH/slabých testech. Existence souborů
  `cli.scanfail.test.ts` / `cli.writefail.test.ts` sama o sobě neuzavírá nález —
  ověřit, že daný test reálně pokrývá popsanou větev a má zuby.
- Cross-module kontrakty (3-8: magický řetězec '.' mezi scan.ts a cli.ts) —
  uzavřít jen pokud je kontrakt jištěn sdílenou konstantou + testem reálného kódu,
  ne jen mockem.
- Verifikace fáze: `mini findings list` ukáže jen reálně platné nálezy; každý
  uzavřený má `--reason` ukazující na konkrétní kód/test. `mini findings list
  --all` dovolí zkontrolovat uzavřené i s důvody.
