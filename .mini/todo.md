# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [ ] Fáze 1 – Kostra: CLI vezme cestu ke složce, projde strom souborů (ignoruje node_modules a .gitignore) a vygeneruje .md report se seznamem souborů + Mermaid diagramem struktury. Ověření: spuštění na reálné složce vyrobí .md s diagramem bez pádu.
- [ ] Fáze 2 – Načtení záměru: najde .mini/project.md (nebo vyžádá project.md, jinak srozumitelně skončí) a vloží záměr + deklarované non-goaly do hlavičky reportu. Ověření: report nahoře ukazuje záměr; běh bez project.md skončí jasnou chybou, ne pádem.
- [ ] Fáze 3 – Strojová analýza kódu: spustí tsc a ESLint, nálezy zapíše do reportu s soubor:řádek a závažností. Ověření: schválně vložená chyba se objeví v reportu na správném místě.
- [ ] Fáze 4 – Strojová bezpečnost: audit závislostí + hledání tajemství (klíče, hesla) v kódu. Ověření: nasazený falešný API klíč report označí.
- [ ] Fáze 5 – Kostra AI vrstvy: napojení na Anthropic API (Claude), odhad rozsahu/nákladů před během, čisté přeskočení bez klíče/internetu. Ověření: bez klíče = 'AI přeskočeno', s klíčem = proběhne testovací dotaz.
- [ ] Fáze 6 – AI logika + non-goaly: krájení projektu na části, poslání kódu + záměru Claudovi, každý nález míří na konkrétní místo v kódu. Ověření: projekt porušující deklarovaný non-goal dostane nález, neporušující ne.
- [ ] Fáze 7 (bonus) – HTML výstup: z .md vyrobí i HTML stránku bez inline stylů/scriptů (CSP). Ověření: vznikne otevíratelná .html vedle .md.
