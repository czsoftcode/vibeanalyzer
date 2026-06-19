# Importy se parsují AST z přibaleného TypeScriptu, ne regexem

## Decision
Relativní importy pro graf modulů se vytahují přes ts.createSourceFile z PŘIBALENÉHO TypeScriptu (závislost vibeanalyzeru, sdíleno přes loadTypescript.ts), ne přes regex a ne z typescriptu analyzovaného projektu.

## Why
Regex byl zvažovanou a zavrženou alternativou (původně i ve formulaci cíle fáze). Selhával ve třech bodech: (1) tahal by falešné nálezy z importů schovaných v komentářích a řetězcích, (2) nespolehlivě by zvládal víceřádkové importy, (3) přibližnost by se musela přiznávat v reportu. AST parser nic z toho nemá. Alternativu 'použít TypeScript z node_modules cíle' jsme zavrhli stejně jako u tsc vrstvy: načtení cizího modulu = vyhodnocení cizího JS = porušení non-goalu č. 1 (kód jen čteme, nespouštíme) a útočná plocha přes trojanizovaný node_modules/typescript. Přibalený parser je navíc vždy dostupný (i na čistě JS projektu bez vlastního TS), takže graf zůstává 'spolehlivý, bez AI', a createSourceFile jen PARSUJE – cizí kód nevykoná.
