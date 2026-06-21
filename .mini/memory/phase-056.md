# Phase 56 — AI vidí celý project.md

**Goal:** Rozšířit Intent o syrový text celého project.md a vstříknout ho do AI promptů (logika i non-goal) jako blok 'Deklarovaný kontext projektu', aby AI posuzovala vůči přístupu, success criteria i omezením; building/nonGoals zůstávají strukturované kvůli bráně a indexaci. Aby se non-goaly (a záměr) neopakovaly dvakrát, vyřízne se z raw textu sekce, které už jdou do promptu strukturovaně. Cross-module kontrakt parser↔prompt → před reportem nezávislý self-review.

## Steps
- [done] Intent.context: vyříznout Non-goals z raw
- [done] Kontext do non-goal promptu
- [done] Kontext do logic promptu
- [done] Zelený typecheck/testy + self-review

## Auto-commit
- Phase 56: AI vidí celý project.md

## Discussion
# Phase 56 — AI vidí celý project.md

## Intent
Dnes AI dostává jen dvě sekce project.md: záměr ("What I'm building") a non-goaly.
Ostatní sekce (Approach, Who it's for, Success criteria, Main constraints, případné
vlastní) parser zahazuje, takže AI posuzuje logiku/non-goaly vůči jediné větě záměru.
Cíl: dodat AI celý project.md jako kontext (syrový text), aby měla úplný deklarovaný
záměr, přístup a kritéria úspěchu, ne jen výřez. Týká se režimů `--ai` (non-goal) a
`--ai-logic`. Režim `--ai-code` se NEMĚNÍ (posuzuje kód nezávisle na záměru).

## Key decisions
- **Jeden společný "kontext" = syrový project.md MINUS sekce `## Non-goals`.** Záměr
  ("What I'm building") v kontextu ZŮSTÁVÁ. Vyříznutí dělá parser podle sdílených
  literálů `INTENT_HEADINGS` (cross-module kontrakt – reuse stejných konstant + stejné
  fence/sibling logiky jako `sectionLines` v intent.ts, neduplikovat ji ručně).
- **Zvláštní blok "# Záměr projektu" v promptech MIZÍ** (v obou). Záměr je doslova
  uvnitř syrového kontextu, separátní blok = duplicita. Toto je ta zjednodušší cesta,
  na kterou se uživatel ptal.
- **Číslovaný seznam non-goalů v non-goal promptu ZŮSTÁVÁ.** NENÍ to duplicita ke
  smazání: je to adresovací mechanismus pro `nonGoalIndex` (AI vrací index, `toFindings`
  ho mapuje zpět na text non-goalu → `rule: non-goal: <text>`). Bez něj se rozpadne
  vazba nálezu na konkrétní non-goal (success criterion). Proto se non-goaly vyříznou
  ze syrové prózy a zůstanou jen jako číslovaný seznam → objeví se 1×.
- **Parsování building + nonGoals zůstává** – pořád řídí brány (logic skip když záměr
  chybí; non-goal skip když žádné non-goaly). Měníme jen, CO jde do promptu, ne brány.
- **Nový tvar promptů:**
  - logic prompt = kontext (syrový bez non-goalů) + kód.
  - non-goal prompt = kontext (syrový bez non-goalů) + číslovaný seznam non-goalů + kód.
- **Nosič kontextu**: nové pole na `Intent` (např. `context: string | null`), spočítané
  v `parseIntent`. `null` = po vyříznutí prázdné. `loadIntent` už syrový obsah čte, jen
  ho dnes zahazuje – zachovat ho.
- **--ai-code** kontext nedostává (potvrzeno).

## Watch out for
- **Prázdný kontext.** Když je project.md minimální (jen záměr + non-goaly), je kontext
  po vyříznutí non-goalů fakticky jen záměr → prompt degraduje na dnešní chování (žádná
  regrese, OK). Když by kontext byl úplně prázdný/null, blok v promptu VYNECHAT (žádný
  prázdný nadpis = šum pro AI).
- **Vyříznutí přes fence/nadpisy.** Použít existující povědomí o code fence a `## `
  předělech (jako `sectionLines`), ať `## Non-goals` v ukázce kódu uvnitř ``` bloku
  nezpůsobí špatné vyříznutí. Nereimplementovat naivně přes split na nadpisy.
- **Cross-module kontrakt parser↔prompt** (záměr/non-goaly se rozdělí mezi syrový
  kontext a strukturovaný seznam) → dle CLAUDE.md před reportem nezávislý self-review.
- **Cena/odhad.** Syrový project.md zvětší vstup promptu (oproti dvěma sekcím). Vůči
  kódu je to drobnost, ale ověřit, zda odhad ceny (fáze 51) počítá z payloadu kódu nebo
  z celého promptu; pokud z kódu, kontext do odhadu nespadne (přijatelné, jen zmínit).
- **Testy se zuby:** (1) `parseIntent` vrací `context` = vše KROMĚ non-goalů, záměr v
  něm zůstává; non-goaly v něm NEJSOU. (2) Minimální project.md → kontext ~ jen záměr →
  prompt jako dnes. (3) Prázdný kontext → blok vynechán. (4) Non-goal prompt pořád
  obsahuje číslovaný seznam (index contract). (5) Vyříznutí ignoruje `## Non-goals`
  uvnitř code fence. (6) Když dočasně rozbiju vyříznutí (non-goaly zůstanou v kontextu),
  test musí padnout.

## Run report
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
