---
phase: 4
verdict: done
steps:
  - title: "Modul intent.ts – lokalizace a čtení souboru"
    status: done
  - title: "Parser dvou sekcí podle pevných nadpisů"
    status: done
  - title: "Render záměru v hlavičce reportu"
    status: done
  - title: "Napojení do run() + varování a nápověda"
    status: done
  - title: "Sebekontrola + celá sada + typecheck + nezávislý sub-agent"
    status: done
---

# Phase 4 — report z auto session

## Co se udělalo
- **`src/intent.ts`** (nový): `loadIntent(targetPath)` hledá `<cíl>/.mini/project.md` → fallback `<cíl>/project.md`. Rozlišený výsledek `loaded` / `absent` / `unreadable`. `parseIntent` vytáhne jen dvě sekce (`## What I'm building`, `## Non-goals`) podle sdílené konstanty `INTENT_HEADINGS`; chybějící i prázdná sekce → `null` (nikdy prázdný string). Čistě read-only.
- **`src/report/markdown.ts`**: `MarkdownInput.intent?`, nová sekce `## Záměr projektu` v hlavičce. Cizí text vkládán jako blockquote (`> `) + `neutralizeFences` (trojitý backtick → jeden). Chybějící část → explicitní `_nedodáno_`.
- **`src/cli.ts`**: `loadIntent` napojen do `run()` před `buildMarkdown`. `unreadable` → varování na **stderr** + pokračuj; `absent` → nápověda na **stdout** + pokračuj; `loaded` → záměr do reportu. Nic se nezapisuje do analyzovaného projektu.
- Testy: `intent.test.ts` (9), rozšířen `markdown.test.ts` (+5) a `cli.test.ts` (+3). **Celkem 66 testů zelených, `tsc --noEmit` čistý.** Reálný smoke test (spuštění nad vlastním projektem) ukázal záměr v reportu korektně.

## Reálné rozhodnutí během práce (kandidát na /mini:decision)
**stdout vs stderr pro chybějící záměr.** Původně šla nápověda na stderr a rozbila existující test `cli.scanfail.test.ts` („úspěch = ticho na stderr"). Místo oslabení testu jsem to vyhodnotil principiálně: chybějící `project.md` je **běžný legitimní stav** → nápověda patří na **stdout** (informace vedle souhrnu); „nečitelný soubor" je **problém** → varování zůstává na **stderr**. Tím se smysl guardu zachoval. Stojí za zápis přes `/mini:decision`.

## Self-review nezávislým sub-agentem (čerstvý kontext)
Žádný blocker. Jeden reálný **should-know opraven**: `sourcePath` se vkládal do inline code spanu bez ochrany (na rozdíl od textu sekcí) → backtick v názvu složky by span rozbil. Opraveno (nahrazení backticku apostrofem) + test se zuby.

## Vědomé trade-offy / co testy NEhlídají
- **Kontrakt s mini není automaticky hlídaný.** Nadpisy `## What I'm building` / `## Non-goals` jsou hardcoded literály (konstanta `INTENT_HEADINGS`). Test je ověřuje proti ručně psanému fixturu ve formátu mini, NE proti reálnému výstupu `mini init`. Když mini nadpisy přejmenuje, fixtur zůstane starý, test projde zeleně a produkce tiše degraduje na „nedodáno". Tuhle vazbu hlídá jen lidská kontrola. Degradace je naštěstí **bezpečná** (žádný pád), proto vědomě nechávám.
- **Nadpis s tabem** (`##\tWhat...`) místo mezery se nenajde → `null` (detekce používá pevnou mezeru, ukončovací regex bere `\s`). Mini píše mezeru, takže neškodí; tichá ale bezpečná degradace. Neřeším (scope).
- **Bez limitu velikosti vstupu** – `readFile` načte celý `project.md` do paměti. Gigantický soubor = vyšší paměť, ne pád. U lokálního CLI nad vlastním projektem akceptovatelné.
- **Injection obrana je přiměřená v kombinaci s blockquote**: 4-mezerový indent i `~~~` fence jsou blockquote prefixem `> ` zneškodněny; samotný `neutralizeFences` cílí jen na ` ``` `. Ověřeno sub-agentem sondami.
- Test větve `unreadable` používá EISDIR (project.md jako adresář) – spolehlivé i pod rootem (na rozdíl od EACCES, který by root obešel).

## Pozn. pro další kroky
- `.mini/graph.json` je vhodné přegenerovat přes `/mini:map` (nový `src/intent.ts`, změněné `cli.ts`, `markdown.ts`).
- Zvážit `/mini:decision` k zápisu rozhodnutí stdout/stderr výše.
