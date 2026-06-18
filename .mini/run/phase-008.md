---
phase: 8
verdict: done
steps:
  - title: "Sdílená cesta k domácímu project.md v projectPaths.ts"
    status: done
  - title: "Render project.md ze záměru"
    status: done
  - title: "Bezpečný zápis writeIntentFile"
    status: done
  - title: "Testy se zuby"
    status: done
  - title: "Adversariální self-review nezávislým sub-agentem + finální kontrola"
    status: done
---

# Phase 8 — report z auto session

## Co vzniklo
- **`src/projectPaths.ts`**: přidány `homeIntentPath(homeDir, targetPath)` (kontraktní cesta `~/.vibeanalyzer/<projectKey>/project.md`, `null` při neznámém domově) a `safeHomedir()`. Obě teď sdílí čtení i zápis záměru → jediné místo pravdy o tom, kde domácí úložiště leží.
- **`src/intent.ts`**: refaktor — privátní `homeCandidate`/`safeHomedir` zrušeny, `loadIntent` čte přes `homeIntentPath`/`safeHomedir`. 17 existujících intent testů prošlo beze změny → kontrakt cesty se nerozešel.
- **`src/intentWriter.ts`** (nový): `renderProjectMd({building, nonGoals})` (nadpisy z `INTENT_HEADINGS` — sdílený literál s parserem) a `writeIntentFile()` s návratovým typem `written | exists | unwritable | no-home`.
- **`src/intentWriter.test.ts`** (nový): 6 testů.

## Ověřeno mechanicky (sám)
- `npm run typecheck` čistý, `npm test` 119/119.
- **Round-trip má zuby**: `render → writeIntentFile → loadIntent` přes REÁLNÝ parser vrátí stejné `building`/`nonGoals`; cestu počítám v testu přes reálnou `projectKey`, takže rozejití kontraktu cesty/nadpisů test shodí.
- **Read-only kontrakt**: test ověřuje, že po zápisu je analyzovaný projekt prázdný (writer píše výhradně do domova).
- **Unhappy path**: existující soubor → `exists` + obsah nezměněn (flag `wx`, bez TOCTOU); neznámý domov (`homeDir: ""`) → `no-home`, nic nevzniklo; nevytvořitelný adresář (soubor v cestě, deterministické i pod rootem) → `unwritable`; vynucené selhání zápisu → `createdDir` uklizen, žádný osiřelý adresář.

## Adversariální review (nezávislý sub-agent, čerstvý kontext)
Mechanika zápisu prověřena jako solidní: atomicita `wx`, rozlišení stavů, úklid `createdDir` nemaže cizí adresář, úzký rozsah `catch`, read-only kontrakt. Reálné nálezy jsou v páru **render ↔ parser** (tichá ztráta dat při vstupu porušujícím precondici renderu):
- **S2**: lichý code-fence (` ``` `) v textu `building` spolkne celou sekci Non-goals (parser je fence-aware) → `nonGoals = null`.
- **S1**: víceřádkový non-goal se tiše ořízne na první řádek.

Reakce: sanitizaci jsem do renderu **nepřidal** — `writeIntentFile` zatím nemá volajícího (mimo testy), a politika (odmítnout/sloučit/escapovat) patří vrstvě, co odpovědi sbírá, ne čistému formátteru; přidat ji teď = spekulativní vrstva. Místo toho jsem precondici (jednořádkové položky, žádné fence/`##` v textu) udělal v docstD `renderProjectMd` **explicitní a hlasitou**, takže přestala být tichá. Toto je vstupní bod pro příští fázi.

## Pro příští fázi (interaktivní vrstva — bývalé todo 13)
Až se bude psát interaktivní sběr odpovědí, MUSÍ garantovat/sanitizovat precondici renderu (S1/S2), jinak se nálezy reálně spustí. Dále zbývá: TTY gate (nehang v non-TTY), napojení do `run()` a nahrazení dnešního „Tip" nabídkou vytvoření.

## Rozhodnutí (ADR)
Padlo jedno reálné rozhodnutí hodné záznamu: **nesanitizovat vstup v renderu, ale precondici delegovat na volajícího** (odmítnutá alternativa: escapovat/sloučit přímo v `renderProjectMd`). Pokud to chceš podržet, spusť před `/mini:done` příkaz `/mini:decision`.
