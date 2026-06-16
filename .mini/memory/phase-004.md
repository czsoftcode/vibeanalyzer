# Phase 4 — Volitelné načtení záměru

**Goal:** Najít záměr a non-goaly v .mini/project.md cílového projektu (fallback project.md), vložit je do hlavičky .md reportu; když chybí nebo je sekce nenalezená, report jede dál a explicitně uvede 'záměr nedodán' – žádný pád, žádný tichý prázdný string.

## Steps
- [done] Modul intent.ts – lokalizace a čtení souboru
- [done] Parser dvou sekcí podle pevných nadpisů
- [done] Render záměru v hlavičce reportu
- [done] Napojení do run() + varování a nápověda
- [done] Sebekontrola + celá sada + typecheck + nezávislý sub-agent

## Auto-commit
- Phase 4: Volitelné načtení záměru

## Discussion
# Phase 4 — Volitelné načtení záměru

## Intent
Před zápisem reportu se VibeAnalyzer podívá do **analyzovaného** projektu (cíl = `parsed.targetPath`, NE vlastní `.mini` VibeAnalyzeru) na záměr a vloží ho do hlavičky `.md` reportu. Záměr je **volitelný**: když chybí, report normálně doběhne a do hlavičky napíše „záměr nedodán" + vypíše nápovědu, jak ho dodat. Slouží jako sémantická kotva pro pozdější AI vrstvu („posuzováno vůči tomuto záměru") – ten framing nálezů ale patří až do AI fáze, ne sem.

## Key decisions
- **Jen 2 sekce:** `## What I'm building` (= záměr) a `## Non-goals`. Sekce `Who it's for`, `Approach`, `Success criteria`, `Main constraints` se teď ignorují (přidat lze později pro AI vrstvu).
- **Pořadí hledání:** `<cíl>/.mini/project.md` → fallback `<cíl>/project.md`. Vždy v analyzovaném projektu.
- **Nadpisy jsou pevné anglické literály** generované `mini init` (`## What I'm building`, `## Non-goals`). Parser se o ně opírá. Fallback uživatelský `project.md` se parsuje stejně podle nadpisů; co nesedí → ta část zůstane „nedodáno", volný text se nehádá.
- **Rozlišení stavů při čtení:**
  - soubor vůbec není (ENOENT obě cesty) → tiše „záměr nedodán" + nápověda (legitimní běžný stav),
  - soubor je, ale nejde přečíst (EACCES apod.) → varování na stderr („našel jsem project.md, ale nešel přečíst: …") + pokračuj s „nedodáno". Programovou chybu nemaskovat jako „nedodáno".
- **Chybějící vs prázdná sekce:** obě → „nedodáno" pro danou část. NIKDY tichý prázdný string v hlavičce – „nedodáno" musí být viditelný stav.
- **Nápověda při chybějícím záměru = JEN hláška** se strukturou (`## What I'm building` / `## Non-goals`). Fáze 4 NIC nezapisuje (read-only vůči analyzovanému projektu = non-goal č. 1).
- **Skutečné zakládání `project.md` = samostatné todo 11** (budoucí fáze). Tam se zapíše do `~/.vibeanalyzer/<projekt>/project.md` (výstupní složka), NE do analyzovaného projektu. Sem to nepatří.

## Watch out for
- **Read-only kontrakt:** fáze 4 nesmí do analyzovaného projektu zapsat nic. Jen čte.
- **Tichý prázdný string:** explicitně rozlišit „nalezeno" vs „nedodáno"; prázdná/chybějící hlavička je past, na kterou si dáváme pozor.
- **Injection do markdownu:** obsah `project.md` je cizí text vkládaný do našeho `.md`. Řádek začínající `#`, ``` ` ``` fence nebo `mermaid` může rozbít strukturu reportu. Vkládat bezpečně (např. jako blockquote `> ` nebo kontrolovaně), ne syrově.
- **Víceřádkové sekce:** záměr může být víc odstavců, non-goaly jsou seznam přes víc řádků – brát blok až do dalšího `## `, ne jen první řádek.
- **Kontrakt s mini (heading literály) je hardcoded:** když mini nadpisy přejmenuje, parser tiše nic nenajde → proto musí chybějící stav degradovat čistě (a nápověda uživateli pomůže).
- **Test reálným fixturem:** parser ověřit proti skutečnému `project.md` (formát z `mini init`), ne jen ručně podaným mock stringem (CLAUDE.md kontrakt mezi moduly).
- **Rozsah catche u čtení:** I/O chybu (čtení souboru) neplest s programovou chybou parseru.
- **Self-run:** spuštění VibeAnalyzeru nad sebou najde tenhle `.mini/project.md` – očekávané, OK.
- **Velikost:** běžně malý soubor; zvážit rozumný strop čtení proti gigantickému/odpadnímu souboru (drobnost).

## Run report
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
