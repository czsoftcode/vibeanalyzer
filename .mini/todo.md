# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [x] Fáze 1 – Kostra: CLI vezme cestu ke složce, projde strom souborů (ignoruje node_modules a .gitignore) a vygeneruje .md report se seznamem souborů + Mermaid diagramem struktury. Ověření: spuštění na reálné složce vyrobí .md s diagramem bez pádu.
- [x] Fáze 2 – Načtení záměru: najde .mini/project.md (nebo vyžádá project.md, jinak srozumitelně skončí) a vloží záměr + deklarované non-goaly do hlavičky reportu. Ověření: report nahoře ukazuje záměr; běh bez project.md skončí jasnou chybou, ne pádem.
- [x] Fáze 3 – Strojová analýza kódu: spustí tsc a ESLint, nálezy zapíše do reportu s soubor:řádek a závažností. Ověření: schválně vložená chyba se objeví v reportu na správném místě.
- [x] Fáze 4 – Strojová bezpečnost: audit závislostí + hledání tajemství (klíče, hesla) v kódu. Ověření: nasazený falešný API klíč report označí.
- [ ] Fáze 5 – Kostra AI vrstvy: napojení na Anthropic API (Claude), odhad rozsahu/nákladů před během, čisté přeskočení bez klíče/internetu. Ověření: bez klíče = 'AI přeskočeno', s klíčem = proběhne testovací dotaz.
- [ ] Fáze 6 – AI logika + non-goaly: krájení projektu na části, poslání kódu + záměru Claudovi, každý nález míří na konkrétní místo v kódu. Ověření: projekt porušující deklarovaný non-goal dostane nález, neporušující ne.
- [ ] Fáze 7 (bonus) – HTML výstup: z .md vyrobí i HTML stránku bez inline stylů/scriptů (CSP). Ověření: vznikne otevíratelná .html vedle .md.
- [x] Plné čtení .gitignore
- [x] Graf modulů (statický): z importů sestavit graf závislostí mezi soubory/moduly a vykreslit ho Mermaidem. Spolehlivé, bez AI. Ověření: u známého projektu sedí hrany importů. Spadá k analýze kódu (fáze 3).
- [ ] Tok logiky od vstupu po výstupy (AI): Claude přečte kód a nakreslí běh od vstupního bodu po výstupy. Každý uzel MUSÍ odkazovat na konkrétní místo v kódu (obrana proti halucinaci) a report uvede, že je to neúplná aproximace. Spadá k AI logické analýze (fáze 6).
- [x] nechat vibeanalyzerem vytvorit project.md, pokud neexistuje od mini
- [ ] komplet parser project.md pro AI
- [x] Interaktivní vytvoření project.md: když záměr není ani v .mini/, ani v ~/.vibeanalyzer/<název>/project.md, nabídnout uživateli vytvoření přes otázky (jako mini-orchestrator) podle vzoru .mini/project.md a uložit do ~/.vibeanalyzer/<název projektu>/project.md (read-only kontrakt cílového projektu zachován). Ošetřit práva/úklid při zápisu do domovského adresáře.
- [x] ESLint analyzátor (druhá půlka původní todo 3): pustit ESLint nad analyzovaným projektem, namapovat výsledky do téhož modelu strojového nálezu a sekce "Strojové nálezy" jako tsc (fáze 12). Pozor: cizí ESLint config (flat vs. legacy) i pluginy v jejich node_modules mohou chybět/být rozbité → čistě přeskočit, ne pád. Ověření: schválně porušené lint pravidlo se objeví v reportu na správném soubor:řádek; projekt bez ESLint configu dá "ESLint přeskočeno".
- [x] Filtr na minifikované .min.js - signál/šum v reportu
- [ ] Prověřit 5 transitivních zranitelností z podstromu ESLintu
- [x] povysit typescript na v6.0.3 a s tim souvisejici dusledky, ale nejdrive prozkoumat dopady
- [ ] Plný sandbox vč. importů
- [x] Mermaid vertikálně ne horizontálně a plný počet adresářů i když budou stovky
- [ ] Rozšířit filtr minifikátů i mimo ESLint (strom souborů, počty Souborů, graf modulů, JSON index). Dnes se .min.* přeskakuje jen v ESLint vrstvě, jinde se počítá → report v jedné sekci bundle přeskočí a o pár řádků níž ho vypíše = protiřečí si. Sjednotit. Případně i obsahová detekce (dlouhý řádek) pro bundly bez .min. přípony (bundle.js).
