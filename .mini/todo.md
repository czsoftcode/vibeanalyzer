# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [x] Fáze 5 – Kostra AI vrstvy: napojení na Anthropic API (Claude), odhad rozsahu/nákladů před během, čisté přeskočení bez klíče/internetu. Ověření: bez klíče = 'AI přeskočeno', s klíčem = proběhne testovací dotaz.
- [ ] Fáze 6 – AI logika + non-goaly: krájení projektu na části, poslání kódu + záměru Claudovi, každý nález míří na konkrétní místo v kódu. Ověření: projekt porušující deklarovaný non-goal dostane nález, neporušující ne.
- [ ] Fáze 7 (bonus) – HTML výstup: z .md vyrobí i HTML stránku bez inline stylů/scriptů (CSP). Ověření: vznikne otevíratelná .html vedle .md.
- [ ] Tok logiky od vstupu po výstupy (AI): Claude přečte kód a nakreslí běh od vstupního bodu po výstupy. Každý uzel MUSÍ odkazovat na konkrétní místo v kódu (obrana proti halucinaci) a report uvede, že je to neúplná aproximace. Spadá k AI logické analýze (fáze 6).
- [ ] komplet parser project.md pro AI
- [ ] Fáze 5b – AI vrstva: reálný testovací dotaz na Anthropic API. Přidat SDK (@anthropic-ai/sdk), s klíčem poslat minimální dotaz a ověřit odpověď; bez klíče/při síťové chybě čistě označit jako přeskočené. Testy s mockem SDK (úspěch, chyba sítě, timeout). Navazuje na fázi 41.
- [ ] Fáze 5c – AI vrstva: odhad rozsahu a nákladů před během. Před voláním API spočítat přibližný počet tokenů/části a zobrazit odhad ceny; uživatel běh potvrdí. Ověření: velký projekt ukáže odhad a počká na potvrzení.
- [ ] K fázi 5b – dodání klíče: primární cesta je env proměnná ANTHROPIC_API_KEY (SDK ji čte sám). NEPŘIDÁVAT vestavěnou .env podporu (dotenv) – nástroj je sám secret scanner a našel by klíč v .env analyzovaného projektu; kdo chce .env, použije nativní node --env-file. Přidat jasnou hlášku, když klíč chybí (jak ho nastavit).
