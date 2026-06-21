# Phase 54 — Uklidit TS2532 v testech

**Goal:** Doplnit non-null assertce a guardy do indexových přístupů ve třech testovacích souborech (aiResult.test.ts, cli.ai.test.ts, aiPayload.test.ts), aby npm run typecheck byl zelený a brána zase chytala reálné regrese místo trvalé červené; tam, kde test ověřuje právě prázdné/undefined, použít guard nebo optional chaining (ne jen !), ať test pořád padá při skutečné regresi.

## Steps
- [done] Sjednotit vzor: ! na prvku, ne ?.
- [done] Opravit aiPayload.test.ts (2 místa)
- [done] Opravit cli.ai.test.ts (9 míst)
- [done] Opravit aiResult.test.ts (34 míst)
- [done] Ověřit zelený typecheck + zuby

## Auto-commit
- Phase 54: Uklidit TS2532 v testech

## Run report
---
phase: 54
verdict: done
steps:
  - title: "Sjednotit vzor: ! na prvku, ne ?."
    status: done
  - title: "Opravit aiPayload.test.ts (2 místa)"
    status: done
  - title: "Opravit cli.ai.test.ts (9 míst)"
    status: done
  - title: "Opravit aiResult.test.ts (34 míst)"
    status: done
  - title: "Ověřit zelený typecheck + zuby"
    status: done
---

# Phase 54 — report z auto session

## Co se udělalo
Brána `npm run typecheck` (tsconfig.test.json, dědí `noUncheckedIndexedAccess: true`) byla trvale červená: 45× TS2532 „Object is possibly undefined", výhradně v testech. Doplnil jsem non-null assertce `!` na indexovaný prvek ve třech souborech:
- `aiPayload.test.ts` — 2 místa (`out.includedFiles[0]!.lineCount`).
- `cli.ai.test.ts` — 9 míst (`seen[0]!.prompt`, `seen[0]!.schema`).
- `aiResult.test.ts` — 34 míst (`f[0]!.…` 30×, `ai.findings[0]!.…` 4×; provedeno přes `replace_all`, předtím ověřeno, že žádný jiný `[0].` v souboru není, takže nedošlo k přestřelení).

## Klíčové rozhodnutí: `!`, ne `?.`
Cíl fáze připouštěl `?.` tam, kde test „ověřuje undefined". Při čtení míst se ukázalo, že **žádný** test netvrdí, že chybí samotný prvek pole — všechny tvrdí, že má/nemá hodnotu nějaká **vlastnost existujícího prvku** (`f[0].file` je undefined apod.). Pro tyto případy by `?.` byl chyba: `expect(f[0]?.file).toBeUndefined()` projde i tehdy, když regrese vrátí prázdné pole (žádný nález vyroben), čímž by test ztratil zuby. Proto napříč všemi 45 místy jednotně `!` na prvku, nikde `?.`, žádné vypnutí `noUncheckedIndexedAccess`.

## Důkaz zubů (sebekontrola #3)
Dočasně jsem v `src/analyze/aiResult.ts` přinutil `toFindings` vrátit `[]`. Dotčené testy spadly **hlasitě** s `TypeError: Cannot read properties of undefined (reading 'file')` (5 failed) — ne tichý průchod. To potvrzuje, že `!` zuby zachovává a `?.` by je smazal. Sondu jsem vrátil; `git diff src/analyze/aiResult.ts` je prázdný (žádný zbytkový edit v produkčním kódu).

## Stav po fázi
- `npm run typecheck` — zelený (0 chyb).
- `npx vitest run` — 603 testů / 57 souborů prošlo.
- Změny jsou jen v testech (assertce); žádná produkční logika, chybové cesty ani mezimodulové kontrakty se nedotkly → nezávislý red-team sub-agent nebyl pro tuto fázi potřeba.

## Pozor pro budoucnost
`!` jen umlčí typ, runtime ochranu nedává — funguje tu proto, že přístup na undefined vždy hodí TypeError a test padne. Kdyby někdo příště psal nové assertce na indexované prvky, držet stejný vzor (`pole[0]!.vlastnost`), ne `?.`, jinak se znovu otevře tichý průchod při „žádný nález".
