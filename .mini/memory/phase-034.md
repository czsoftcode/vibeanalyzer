# Phase 34 — Triáž a úklid otevřených nálezů

**Goal:** Projít všech 22 otevřených review nálezů proti aktuálnímu kódu, u prokazatelně vyřešených je uzavřít přes 'mini findings resolve' s odůvodněním odkazujícím na konkrétní kód/test, a zbylé nechat otevřené s krátkou poznámkou, proč stále platí. Ověření: 'mini findings list' po fázi ukáže jen nálezy, které reálně platí; každý uzavřený má --reason ukazující na místo v kódu/testu, které ho řeší.

## Steps
- [done] Re-mapovat 22 nálezů na aktuální kód
- [done] Triáž nálezů 1-x a 2-x mimo testy (6 ks)
- [done] Triáž nálezů o testech a pokrytí (5 ks)
- [done] Triáž chybových cest cli.ts (10 ks)
- [done] Triáž cross-module kontraktu 3-8 (1 ks)
- [done] Finální kontrola a soupis

## Auto-commit
- Phase 34: Triáž a úklid otevřených nálezů

## Discussion
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

## Run report
---
phase: 34
verdict: done
steps:
  - title: "Re-mapovat 22 nálezů na aktuální kód"
    status: done
  - title: "Triáž nálezů 1-x a 2-x mimo testy (6 ks)"
    status: done
  - title: "Triáž nálezů o testech a pokrytí (5 ks)"
    status: done
  - title: "Triáž chybových cest cli.ts (10 ks)"
    status: done
  - title: "Triáž cross-module kontraktu 3-8 (1 ks)"
    status: done
  - title: "Finální kontrola a soupis"
    status: done
---

# Phase 34 — report z auto session

## Výsledek

Triáž 22 otevřených nálezů proti AKTUÁLNÍMU kódu. **Žádný produkční kód se neměnil**
(striktně triáž dle diskuze). Změnil se jen store `.mini/findings/`.

- **16 uzavřeno** jako prokazatelně vyřešené: `2-15`, `3-1` až `3-15`.
- **6 zůstává otevřených** (reálné, ale neopravené – dle rozhodnutí z diskuze nechat
  jako poctivý backlog, neuzavírat jako wontfix): `1-4`, `1-5`, `1-6`, `2-7`, `2-11`, `2-16`.

Každý uzavřený nález má v storu `--reason` s konkrétním soubor:řádek (kód i test).

## Proč šlo uzavřít 16 nálezů (kód se mezitím přepsal)

Nálezy 3-x pocházejí z commitu `483e482`, od kterého je 31 commitů. Klíčové změny,
které je vyřešily:

- **`isEntrypoint` zcela zrušen** → `bin.ts` je dedikovaný spustitelný vstup, který
  volá `runCli` (`cliMain.ts`) bezpodmínečně. Tím padají `3-1`, `3-2`, `3-4`
  (žádná detekce → žádný crash při importu, žádný tichý exit 0). `runCli` vrací při
  chybě exit 1 (testy `cliMain.test.ts`).
- **mkdir(outDir) přesunut AŽ za scan+guard** (`cli.ts:411`) → `3-9`, `3-12`.
- **Cleanup přes `rm(createdDir)`** (jen co nástroj vytvořil; undefined když outDir
  existoval; recursive maže i mezičlánky) → `3-10`, `3-14`, `3-15`.
- **try/catch kolem scanTree i build* odstraněn** → programové chyby probublají se
  stackem do launcheru, I/O řeší defenzivní scanTree + guard → `3-3`, `3-7`, `3-11`.
- **Sdílená konstanta `ROOT_UNREADABLE_MARKER`** (scan.ts:72, importovaná v cli.ts)
  místo magického literálu `'.'` + test reálné emise (scan.test.ts:269) → `3-8`.
- **Nové testy se zuby**: `cli.test.ts` (neplatný cíl, mkdir ENOTDIR),
  `cli.writefail.test.ts`, `cli.scanfail.test.ts`, `cli.entrypoint.test.ts`
  (shebang + přímé spuštění symlinku, launcher s házející cli.js) → `2-15`, `3-5`,
  `3-6`, `3-13`.

## Proč 6 zůstává otevřených (ověřeno proti aktuálnímu kódu, ne podle starých řádků)

- **1-4** `escapeLabel` (markdown.ts:50) pořád řeší jen `"` a `[]`, ne `#`/newline.
  (Pozn.: novější `escapeNodeLabel` pro graf modulů je přísnější, ale `escapeLabel`
  pro strom struktury ne.) Nit.
- **1-5** `timestamp.ts:6-8` má dál rozlišení na ms → kolize ve stejné ms přepíše. Nit.
- **1-6** `args.ts:53-54`: `--out=` (prázdné) pořád projde do `path.resolve(cwd,"")`=cwd.
  Mezera: prostorová forma `--out` se nově validuje (args.ts:46), ale `--out=` ne. Nit.
- **2-7** `writeOutputs.ts:31-32`: úklid maže obě cesty bezpodmínečně (ne "co jsem
  vytvořil"). Dokumentovaný záměrný kompromis, chování nezměněné → není to "fix". Nit.
- **2-11** `scan.ts:208,249`: u DT_UNKNOWN souboru pořád lstat + stat (dva syscally). Nit.
- **2-16** `writeOutputs.ts`: pár-atomicita (buď oba, nebo žádný) smaže validní JSON,
  když selže jen MD. Nález sám to označil jako ROZHODOVACÍ BOD pro člověka, ne defekt.
  Kandidát na ADR (vědomě přijmout, nebo změnit na "radši JSON než nic"). should-know.

## Ověření

- `npm run typecheck` → čistý.
- `npm test` → **381 testů, 45 souborů, vše zelené** (21,5 s). Testy, o které se uzávěry
  opírají jako o "zuby", reálně procházejí.
- `mini findings list` → ukazuje přesně 6 výše uvedených otevřených, nic falešně
  otevřeného (= už opraveného) nezůstalo.
- **Nezávislý adversariální sub-agent** (čerstvý kontext, aby nesdílel můj blind spot)
  přezkoumal rizikovější uzávěry (12 should-know + subtilních) proti aktuálnímu kódu
  se zadáním "zkus dokázat, že se spletl" → **žádné falešné uzavření nenašel**.

## Poznámka pro člověka (mimo rozsah nálezů, žádný nový finding nezakládám)

Sub-agent upozornil na latentní hranu: `cli.ts:47` (`fileURLToPath(import.meta.url)`
pro CHILD_PATH) je top-level kód běžící při importu; v ne-`file:` ESM runtime
(data:/http: loader, bundler) by hodil výjimku MIMO dosah launcher catche. V deklarovaném
provozu (Node CLI z dist nebo tsx) je to nedosažitelné, takže to není regrese – jen
hrana, kdyby se nástroj někdy bundloval. Není to znovuotevření 3-1.

## Doporučení k dalším fázím

`1-6` (prázdné `--out=`) je nejlevnější reálná oprava a je nekonzistentní s tím, že
`--out <space>` se už validuje – dobrý kandidát na samostatnou mini-fázi z
`--from-finding 1-6`. `2-16` patří spíš do `/mini:decision` (ADR), ne do opravy kódu.
