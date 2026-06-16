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
