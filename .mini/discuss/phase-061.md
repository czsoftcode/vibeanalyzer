# Phase 61 — Ošetřit pád čtení AI vrstvy

## Intent
AI vrstva (`runAiLayer`, volaná z `cli.ts:452`) jako JEDINÁ vrstva nemá kolem sebe
`try/catch` a nedegraduje na `skipped` (graf modulů `cli.ts:440-446`, tsc, ESLint,
secrets, audit ano). Uvnitř `splitAiPayload` (`aiPayload.ts:135`) se přes `Promise.all`
čtou VŠECHNY vybrané soubory; když jeden zmizí / změní práva mezi scanem stromu a AI
během (TOCTOU), `Promise.all` rejectne → chyba probublá `runAiLayer` → `run()` →
`runCli` catch → **exit 1, ŽÁDNÝ report** (zahodí se i hotové strojové vrstvy).
Cíl: selhání čtení (i selhání setupu AI vrstvy) degraduje vyžádané AI režimy na
`skipped` se srozumitelným důvodem, report se vždy vyrobí (exit 0).

## Key decisions
- **Varianta A (zvolena): přeskočit CELOU AI vrstvu**, ne jen nečitelný soubor.
  Konzistentní se všemi ostatními vrstvami, poctivé (uživatel vidí „AI neproběhla").
  Varianta B (skip jen souboru, jako `skippedUnreadable` ve stromu) ZAMÍTNUTA: mění
  tvar payloadu, AI by viděla neúplný projekt → tiché zkreslení nálezů → scope creep.
- **Rozsah catch: obalit čtení I dynamické importy.** Nechráněné jsou i `import()`
  na `cli.ts:567/573/574` (SDK/orchestrátor) – ty mají spadnout pod stejnou degradaci
  jako čtení souborů. Catch obalí blok od resolvování analyze/classify + importů přes
  `splitAiPayload` (klidně až po finální `return` úspěšné cesty).
- **Nemaskovat tiše:** v catchi VYPSAT stack na stderr a teprve pak degradovat na
  `skipped` (vzor `runOneAiMode` `cli.ts:689-692` a `--ai-check` `cli.ts:654-661`).
  Tím se kryje i nečekaná programová chyba, aniž by zmizela (CLAUDE.md pravidlo 2).
- **Které režimy jdou skipped:** jen VYŽÁDANÉ (`wantNonGoal`/`wantCode`/`wantLogic`)
  → `skipped`; nevyžádané zůstávají `pre` (ready) – přesně jako gate ceny `cli.ts:604-609`.
- **Reason text** poctivý k příčině, např. „AI vrstva přeskočena: čtení souborů
  projektu selhalo (soubor zmizel/změna práv během běhu nebo selhal setup) – viz stderr".

## Watch out for
- **BEZ bumpu JSON indexu.** Znovupoužíváme existující `AiStatus { kind: "skipped" }`,
  tvar `AiReport` se NEMĚNÍ → verze indexu zůstává. (Narozdíl od fáze 60.) Ověřit, že
  se opravdu nemění žádné pole.
- **`oversizedFiles` při selhání není k dispozici** (čtení nedoběhlo) → v degradované
  návratové hodnotě ho vynechat (jako u gate-skip se vyplňuje jen po úspěchu splitu).
- **Žádný úklid není potřeba:** `splitAiPayload` jen ČTE, po selhání nezůstává žádný
  stav/soubor. Nepřidávat zbytečnou cleanup větev.
- **Pozor na vnořené catche:** `runOneAiMode` má vlastní `try/catch` pro PROVOZNÍ
  chyby běhu částí – ten zůstává a do vnějšího catche se nedostane. Vnější catch řeší
  jen setup+čtení (a nečekané). Nepřekrýt jejich odpovědnosti.
- **Test se zuby přes REÁLNÝ kód, ne mock literál (CLAUDE.md pravidlo 4/cross-module):**
  `readFile`, který pro jeden soubor rejectne (ENOENT/EACCES), poslat přes REÁLNÝ
  `splitAiPayload` + `runAiLayer` → ověřit: vyžádané režimy = `skipped`, strojové
  vrstvy v reportu zůstaly, exit 0. Druhý test: selhání dynamického importu (přes deps
  injektáž nebo simulaci) → také degradace, ne pád. Když ochranný catch dočasně rozbiju,
  test musí spadnout.
- **Nezahltit catch tak, aby polkl i úspěšnou cestu** – estimate/gate/runs musí dál
  fungovat normálně; degradace je jen pro chybový průchod.
- Před reportem nezávislý self-review sub-agentem (fáze sahá na chybovou cestu a vstupní
  bod procesu – CLAUDE.md).
