# Oddělené AI přepínače místo jednoho dotazu s polem category

## Decision
AI analýza non-goalů a kódu se spouští dvěma samostatnými přepínači (--ai-non-goal, --ai-code), každý posílá vlastní dotaz na API s vlastním promptem a vlastním JSON schématem. Žádné společné pole category rozlišující druh nálezu v jednom dotazu. Stejnou logikou je i budoucí --ai-logic (funkčnost celku vůči záměru) vyčleněn jako třetí samostatný režim, ne další hodnota category.

## Why
Původní plán fáze byl jeden dotaz s polem category (non-goal | code), levnější o jedno volání API. Zamítnut: míchání dvou různých analytických cílů do jednoho promptu zhoršuje kvalitu obojího a zvyšuje halucinace (model hádá kategorii), schéma by muselo nonGoalIndex zobecnit a tím rozvolnit kontrakt vazby na deklarované non-goaly. Oddělené přepínače dají čistší prompty, zachovají nonGoalIndex jen u non-goal cesty a umožní změřit cenu každého režimu zvlášť (podklad pro odhad ve Fázi 5c). Třetí režim --ai-logic je navíc mechanismem natolik odlišný (posuzuje celek, ne jednotlivá místa; vyvozuje záměr z kódu), že do společného dotazu/schématu nepatří už vůbec. Vědomě přijatý trade-off: spuštění více režimů = více volání API = násobná cena; uživatel ale platí jen za to, co si vyžádá.
