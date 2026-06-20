# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [x] Fáze 5 – Kostra AI vrstvy: napojení na Anthropic API (Claude), odhad rozsahu/nákladů před během, čisté přeskočení bez klíče/internetu. Ověření: bez klíče = 'AI přeskočeno', s klíčem = proběhne testovací dotaz.
- [x] Fáze 6 – AI logika + non-goaly: krájení projektu na části, poslání kódu + záměru Claudovi, každý nález míří na konkrétní místo v kódu. Ověření: projekt porušující deklarovaný non-goal dostane nález, neporušující ne.
- [ ] Fáze 7 (bonus) – HTML výstup: z .md vyrobí i HTML stránku bez inline stylů/scriptů (CSP). Ověření: vznikne otevíratelná .html vedle .md.
- [ ] Tok logiky od vstupu po výstupy (AI): Claude přečte kód a nakreslí běh od vstupního bodu po výstupy. Každý uzel MUSÍ odkazovat na konkrétní místo v kódu (obrana proti halucinaci) a report uvede, že je to neúplná aproximace. Spadá k AI logické analýze (fáze 6).
- [ ] komplet parser project.md pro AI
- [x] Fáze 5b – AI vrstva: reálný testovací dotaz na Anthropic API. Přidat SDK (@anthropic-ai/sdk), s klíčem poslat minimální dotaz a ověřit odpověď; bez klíče/při síťové chybě čistě označit jako přeskočené. Testy s mockem SDK (úspěch, chyba sítě, timeout). Navazuje na fázi 41.
- [ ] Fáze 5c – AI vrstva: odhad rozsahu a nákladů před během. Před voláním API spočítat přibližný počet tokenů/části a zobrazit odhad ceny; uživatel běh potvrdí. Ověření: velký projekt ukáže odhad a počká na potvrzení.
- [x] K fázi 5b – dodání klíče: primární cesta je env proměnná ANTHROPIC_API_KEY (SDK ji čte sám). NEPŘIDÁVAT vestavěnou .env podporu (dotenv) – nástroj je sám secret scanner a našel by klíč v .env analyzovaného projektu; kdo chce .env, použije nativní node --env-file. Přidat jasnou hlášku, když klíč chybí (jak ho nastavit).
- [ ] Doplnit help o vsechny ovladace prikazu vibeanalyzer
- [x] Rozšířit AI analýzu o logiku a obecný kód (ne jen non-goaly): logické chyby, divné/riskantní vzorce. Navazuje na fázi 43 (ta dělá jen non-goaly). Každý nález míří na konkrétní místo v kódu.
- [ ] Fáze AI-logika: přepínač --ai-logic. Posuzuje funkčnost kódu jako CELEK vůči záměru z project.md; kde project.md není, vyvodit záměr z kódu a říct, kde se to s ním rozchází (víc než mini audit do codebase.md). Jiný mechanismus než non-goal/code: nález nemusí mířit na jeden řádek, posuzuje celek; vyvození záměru z kódu je nejrizikovější na halucinace. Navazuje na fázi 44 (ta dělá non-goal + code). Každý nález ať co nejvíc ukazuje na konkrétní místo v kódu.
- [ ] classifyAiError nezná overloaded_error (HTTP 529, server přetížen) – při reálném běhu fáze 44 probublal jako 'nečekaná chyba' se stackem místo čisté degradace 'API přetížené, zkus později'. Týká se SDÍLENÉ AI vrstvy (ping i analýza, oba režimy). Pozor: chyba přišla přes streaming (prefix 'Error:'), ověřit, zda je to instance Anthropic.InternalServerError/APIError nebo generický Error (podle toho instanceof vs kontrola err.type/status===529). Degradace teď funguje (exit 0, report vznikne), jde o čistotu klasifikace. Doplnit i test.
