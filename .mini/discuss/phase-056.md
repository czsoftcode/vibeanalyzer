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
