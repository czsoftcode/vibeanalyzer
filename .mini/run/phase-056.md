---
phase: 56
verdict: done
steps:
  - title: "Intent.context: vyříznout Non-goals z raw"
    status: done
  - title: "Kontext do non-goal promptu"
    status: done
  - title: "Kontext do logic promptu"
    status: done
  - title: "Zelený typecheck/testy + self-review"
    status: done
---

# Phase 56 — report z auto session

## Co se udělalo
AI vrstva (režimy `--ai` non-goal a `--ai-logic`) teď dostává **celý project.md**
jako „deklarovaný kontext", ne jen záměr + dvě sekce. Dřív AI posuzovala vůči jediné
větě záměru; nově vidí i Approach, Success criteria, Main constraints, Who it's for
i případné vlastní sekce.

- `src/intent.ts`: nové pole `Intent.context: string | null`. Počítá se v `parseIntent`
  jako **syrový project.md MINUS sekce `## Non-goals`** (záměr a vše ostatní zůstává).
  Refaktor: z původního `sectionLines` vyextrahován sdílený `findSectionRange` (vrací
  rozsah řádků sekce, fence/sibling-aware); nové `stripSection` (odstraní nadpis i tělo
  sekce) a `extractContext` (vyřízne Non-goals, trimne, prázdné → null).
- `src/analyze/aiResult.ts`:
  - `buildAnalyzePrompt`: první parametr `building` → `context`; blok „# Deklarovaný
    kontext projektu (z project.md)" se vynechá, když je kontext null/prázdný; **číslovaný
    seznam non-goalů ZŮSTÁVÁ** (adresování `nonGoalIndex` → `toFindings`).
  - `buildLogicPrompt`: parametr `building` → `context`, stejné vynechání prázdného bloku.
  - Orchestrátory `runAiAnalysis` / `runAiLogicAnalysis` předávají `intent?.context`.
    Brány (non-goal na `nonGoals`, logika na `building`) zůstaly beze změny.
- `--ai-code` se NEMĚNILO (posuzuje kód nezávisle na záměru) – dle zadání.

## Proč se non-goaly z kontextu vyřezávají
Do non-goal promptu jdou non-goaly dál jako číslovaný seznam (`0: …`, `1: …`), protože
ten index je adresa, na kterou AI věší nálezy (`nonGoalIndex`). Kdyby zůstaly i v syrovém
kontextu, byly by tam dvakrát. Vyříznutím v parseru se objeví právě jednou.

## Ověření
- `npm run typecheck`: zeleně.
- `npx vitest run`: **618 testů zeleně** (celá sada). Nové testy se zuby v `intent.test.ts`
  (kontext drží záměr+ostatní sekce, NE non-goaly; `## Non-goals` ve fence se nevyřízne;
  minimální project.md degraduje na dnešek; prázdné → null) a v `aiResult.test.ts`
  (kontext v promptu, prázdný → blok vynechán, číslovaný seznam non-goalů zůstává).
- Nezávislý sub-agent (čerstvý kontext, dle CLAUDE.md – fáze sahá na cross-module kontrakt
  a vstupní cesty): bez blockerů. Mutačně potvrdil zuby (rozbití vyříznutí → 3-4 testy
  padají) a fuzzem 11 100 kombinací sekcí ověřil invariant „building neprázdné ⇒ context
  neprázdné" (0 porušení) – logika tedy nikdy nedostane prompt bez záměru.

## Vědomé kompromisy / pozor pro budoucnost
- **Odhad ceny kontext nepočítá.** `estimateAiCost` (fáze 51) bere vstupní tokeny jen
  z `payload.text.length` (kód), ne z celého promptu – systémový prompt, kontext ani
  číslovaný seznam non-goalů do odhadu nespadají. Platilo to už dřív; přidání syrového
  project.md ten podhled mírně rozšiřuje. Magnituda: project.md má typicky jednotky kB
  vs. stovky kB kódu → zanedbatelné. Kdyby se v budoucnu posílaly velmi velké project.md,
  je to kandidát na úpravu.
- **Report nezobrazuje, že AI dostala širší kontext.** `.md` report dál ukazuje jen
  `building` + `nonGoals` (sekce „Záměr"). Čtenář reportu tak nevidí, že AI posuzovala
  i vůči Approach/Success criteria. Není to chyba téhle fáze (report jsme nesahali),
  jen poznámka – případná samostatná fáze.
- **CRLF vstup** vyjde v kontextu s LF (join na `\n`) – pro AI prompt irelevantní.
