# Ideas & changes

> Archive of future ideas and changes for this project. Managed by `mini todo`
> (`add` / `done` / `remove`); `mini next` offers the open items as candidate
> phase ideas. You can also edit this checklist by hand.
- [ ] Fáze 7 (bonus) – HTML výstup: z .md vyrobí i HTML stránku bez inline stylů/scriptů (CSP). Ověření: vznikne otevíratelná .html vedle .md.
- [ ] Tok logiky od vstupu po výstupy (AI): Claude přečte kód a nakreslí běh od vstupního bodu po výstupy. Každý uzel MUSÍ odkazovat na konkrétní místo v kódu (obrana proti halucinaci) a report uvede, že je to neúplná aproximace. Spadá k AI logické analýze (fáze 6).
- [ ] Doplnit help o vsechny ovladace prikazu vibeanalyzer
- [x] classifyAiError nezná overloaded_error (HTTP 529, server přetížen) – při reálném běhu fáze 44 probublal jako 'nečekaná chyba' se stackem místo čisté degradace 'API přetížené, zkus později'. Týká se SDÍLENÉ AI vrstvy (ping i analýza, oba režimy). Pozor: chyba přišla přes streaming (prefix 'Error:'), ověřit, zda je to instance Anthropic.InternalServerError/APIError nebo generický Error (podle toho instanceof vs kontrola err.type/status===529). Degradace teď funguje (exit 0, report vznikne), jde o čistotu klasifikace. Doplnit i test.
- [ ] odvození záměru z kódu
- [ ] skip pri velkych projektech i na goal a code nebo zvetsit okno na vice tokenu
- [ ] Per-model vstupní strop (symetrie k fázi 50). Dnes je AI_PAYLOAD_CHAR_BUDGET (800k znaků ≈ ~240k tokenů) GLOBÁLNÍ – collectAiPayload staví payload jednou, bez ohledu na model. opus-4.8 i glm-5.2 mají okno 1M (ověřeno z docs), takže u nich lze vstupní strop výrazně zvednout (po odečtení 64k výstupu ~930k tokenů ≈ ~3M znaků volných). Návrh: přesunout vstupní strop do AI_PROVIDERS jako per-model hodnotu, glm/opus vyšší, sonnet ne (neosvědčil se – kandidát i na úplné vyřazení z nabídky modelů). POZOR: (1) vyžaduje protáhnout model do collectAiPayload; (2) cena škáluje lineárně a odhad PŘED během stále neexistuje (todo 7) → bez něj velký vstup = překvapení účtem; (3) lost-in-the-middle: obří kontext může zhoršit lokalizaci nálezů; (4) robustnější cesta pro velké projekty je krájení na části (backlog), ne nafouknutý single-shot. Doporučené pořadí: napřed odhad ceny, pak krájení; per-model vstupní strop je rychlý dílčí krok jen s odhadem ceny.
- [ ] Dát pryč sonnet
- [ ] dat vibeanalyzer jako skills do claude code
