# Úložiště projektu pod ~/.vibeanalyzer keyované basename-hash ve sdíleném modulu

## Decision
Soubory projektu mimo cíl (report i záměr project.md) leží v jedné složce ~/.vibeanalyzer/<projectKey>/, kde projectKey = basename-<8 hex SHA-1 absolutní cesty>. Klíč žije ve sdíleném src/projectPaths.ts, importují ho oba konzumenti (args.defaultOutDir i intent.loadIntent).

## Why
Klíč: zvažoval jsem jen basename (existující schéma v args.ts) – zamítnuto, protože dva projekty se stejným jménem z různých cest (/a/app, /b/app) by sdílely složku → tichý přepis cizího reportu a čtení cizího záměru (přesně ten falešný výsledek, proti kterému nástroj stojí). Čistý hash bez prefixu zamítnut kvůli nečitelnosti (uživatel složku nenajde). basename-hash má obojí: čitelnost i kolizní bezpečnost.

Sdílený modul: alternativa nechat klíč v jednom z modulů a druhý ať ho importuje zamítnuta – args (parsování) by sémanticky záviselo na intent (čtení záměru). Sdílený projectPaths.ts drží kontrakt na jednom místě; když se schéma změní, mění se jednou a oba konzumenti zůstanou v souladu (jinak hrozí přesně ten rozpor, který tahle fáze řešila: report v app/, záměr v app-hash/).
