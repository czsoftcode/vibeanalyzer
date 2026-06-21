# Changelog

Všechny podstatné změny tohoto projektu jsou zaznamenány v tomto souboru.

Formát vychází z [Keep a Changelog](https://keepachangelog.com/cs/1.1.0/)
a projekt používá [sémantické verzování](https://semver.org/lang/cs/).

## [Unreleased]

### Changed

- **Cena rozkrájeného AI běhu se už nepodhodnocuje.** Když některá část přijde o výstup
  kvůli limitu modelu (utnutý/prázdný výstup), API ji přesto naúčtuje. Nově se tahle cena
  počítá do celkové ceny běhu i strukturovaně (v JSON reportu), ne jen jako text – takže
  součet sedí i v případě, že selže víc částí najednou. (Pozn.: v markdown reportu se cena
  přeskočené části zatím ukazuje jen v textu důvodu.) Verze JSON indexu zvýšena na 19;
  konzumenti JSON musí počítat se změnou tvaru (varianta `skipped` nese nepovinné
  `usage`/`costUsd`).

### Fixed

- **Zmizelý nebo nečitelný soubor během AI analýzy už neshodí celý report.** Když se
  některý zdrojový soubor smaže nebo mu během běhu zmizí práva (mezi naskenováním stromu
  a čtením pro AI), AI vrstva se nově **čistě přeskočí** se srozumitelným důvodem – přesně
  jako ostatní vrstvy (tsc, ESLint, …). Report se i tak vyrobí s výsledky strojových
  vrstev (skončí úspěchem), místo dřívějšího pádu s `exit 1` a žádným reportem.

## [0.6.0] - 2026-06-21

### Added

- **Velké projekty se pro AI vrstvu krájí na části.** Co se dřív kvůli velikosti do
  jednoho dotazu nevešlo a uřízlo se, se teď rozdělí na víc částí a pošle celé – AI tak
  posoudí celý projekt, ne jen jeho začátek. Okno se plní jen na 75 % (rezerva proti
  přetečení a pro přesnější míření nálezů). Report u rozděleného běhu uvede, **na kolik
  částí se projekt rozdělil**, a poctivě přizná, že rozdělený běh **nevidí souvislosti
  napříč částmi** (logika/non-goaly mezi moduly jsou tak slabší). Když některá část
  provozně selže (např. přetížené API), ostatní se posbírají a report přizná, kolik
  částí a proč selhalo – běh nespadne.

### Changed

- **Odhad ceny AI počítá s počtem částí.** U velkého (rozkrájeného) projektu odhad i práh
  potvrzení zohlední, že každá část je samostatné volání (výstup roste s počtem částí),
  takže cena nepřekvapí.
- Report **už nehlásí „kód uříznut"** (to konceptem krájení zaniklo) – místo toho hlásí
  rozdělení na části. Pole `truncation` v JSON reportu je nahrazeno polem `chunking`
  (verze indexu 18); konzumenti JSON musí počítat se změnou tvaru.

## [0.5.0] - 2026-06-21

### Added

- Report nově **přiznává, když AI posuzovala neúplný projekt**, protože se zdrojový kód
  kvůli celkovému stropu uřízl. Uvede, **kolik souborů AI vidělo z celku** a **kolik kódu**
  (řádově v kB) se do dotazu nevešlo – v sekci „AI analýza" v `.md` i v poli `ai.truncation`
  v JSON (verze indexu 17). Stejné znění na stderr i v reportu, žádné tiché zatajení
  neúplnosti. Doplňuje dřívější přiznání per-file vynechaných souborů (`ai.oversizedFiles`).
  Počet souborů je přesný; velikost je přibližná (bajty ≠ znaky u UTF-8), tokeny se vědomě
  nevykazují.
- **Odhad ceny AI před během.** Před každým reálným AI dotazem se teď vypíše přibližný
  odhad ceny jako rozsah („řádově $X až nejvýš $Y", explicitně označený jako odhad, ne
  fakturace). Počítá se z reálné délky posílaného kódu × ceník zvoleného modelu; vstup
  i výstup se násobí počtem zapnutých režimů (každý posílá celý kód zvlášť). Když
  odhadovaná horní mez přesáhne práh ($0.50), nástroj se v terminálu **zeptá na potvrzení**;
  v neinteraktivním běhu (skript, roura) AI vrstvu **čistě přeskočí** s důvodem (report
  vznikne, exit 0). Nová vlajka **`--ai-yes`** cenu potvrdí předem a běh pustí bez ptaní
  (nutná pro neinteraktivní běh nad prahem).
- Nová volba modelu **`--ai-model glm`** (GLM-5.2 od Z.ai) jako třetí možnost vedle
  `opus`/`sonnet` – výrazně levnější (vstup $1,4 / výstup $4,4 za milion tokenů oproti
  opus $5 / $25), běží přes Anthropic-kompatibilní endpoint Z.ai s vlastním klíčem
  **`ZAI_API_KEY`**. Funguje u **všech tří AI režimů** (`--ai-code`, `--ai-non-goal`
  i `--ai-logic`) – vrací reálné nálezy mířící na konkrétní místo v kódu. Z.ai nevynucuje
  JSON schéma odpovědi jako Anthropic, proto si nástroj ve všech třech režimech umí poradit
  s tvarem, který glm vrací (obal, holé pole i JSON v markdown ohrazení). Strop délky
  výstupu i míra „přemýšlení" jsou pro glm doladěné (viz Fixed níže), takže `--ai-logic`
  i na velkém projektu vrací nálezy a neuřezává se.
- Report nově **přiznává zdrojové soubory, které AI nevidělo**, protože překročily strop
  na jeden soubor (100 kB) – vypíšou se jednou v sekci „AI analýza" v `.md` i v poli
  `ai.oversizedFiles` v JSON. Žádné tiché vynechání: víš, co se do dotazu nedostalo.
- Nový přepínač **`--ai-logic`** spustí reálnou **AI analýzu funkčnosti kódu jako celku
  vůči záměru** z `project.md` (sekce „What I'm building") – hledá, kde kód neplní, co
  slibuje (chybějící funkčnost, rozpor se záměrem). Na rozdíl od ostatních AI režimů
  nález **nemusí mířit na jeden řádek** (posuzuje celek); když místo uvede, ověří se
  proti poslanému souboru. Je to vědomě **neúplná aproximace** – obrana proti halucinaci
  je tu nejslabší ze tří režimů, což report výslovně přiznává. Bez záměru se režim čistě
  přeskočí (záměr je povinný vstup). Drahá cesta je opt-in, běží nezávisle a má vlastní
  prompt, schéma, spotřebu tokenů i cenu. Tři AI režimy (`--ai-non-goal`, `--ai-code`,
  `--ai-logic`) jdou zapnout i naráz.
- Nový přepínač **`--ai-code`** spustí reálnou **AI analýzu kvality a rizik kódu** –
  hledá problémy, které nezachytí parser, tsc ani ESLint (logické chyby, riskantní
  vzorce, race conditions, neošetřené chyby). Každý nález míří na konkrétní místo
  v kódu (ověřené proti poslanému souboru – jinak označené „místo neověřeno") a nese
  druh problému (např. „kód: race condition"). Drahá cesta je opt-in; běží nezávisle
  na non-goalech a má vlastní prompt i schéma. Report a stderr ukážou skutečnou
  spotřebu tokenů a odhad ceny zvlášť pro tento režim.

### Changed

- **AI analýza logiky a non-goalů nově posuzuje vůči celému `project.md`, ne jen vůči
  jedné větě záměru.** Dřív AI dostala jen sekce „What I'm building" + „Non-goals";
  ostatní (Approach, Who it's for, Success criteria, Main constraints i případné vlastní
  sekce) se zahazovaly. Nově dostane **celý deklarovaný kontext** projektu, takže může
  posoudit, jestli se kód rozchází i s deklarovaným přístupem nebo kritérii úspěchu.
  Non-goaly se přitom do dotazu posílají **právě jednou** (jako číslovaný seznam, na který
  se věší nálezy), aby se neopakovaly. Analýza kódu (`--ai-code`) se nemění – ta posuzuje
  kód nezávisle na záměru. Pozn.: odhad ceny počítá vstup dál jen z velikosti kódu, ne
  z celého promptu – `project.md` je proti kódu zanedbatelný.

- **Potvrzení ceny AI se nově ptá podle realistického odhadu, ne podle nejhoršího případu.**
  Dřív se práh ($0.50) porovnával s worst-case cenou (celý výstupní strop modelu), což
  u modelu `glm` (strop 131072 tokenů) znamenalo, že se nástroj ptal **vždycky** – i na
  malém projektu s nulovým vstupem, kde reálná cena jsou centy. Brána tím ztrácela smysl
  a `--ai-yes` byl skoro povinný. Nově se rozhoduje podle realistického odhadu (vstup
  + typický výstup), takže se nástroj ptá jen tam, kde to dává smysl (hodně režimů nebo
  velký vstup). **Worst-case rozsah se ve výpisu dál ukazuje** („až nejvýš $Y") – jen už
  nespouští dotaz. Práh $0.50 beze změny. Pozor: u `glm` s vyšším „přemýšlením" může
  reálný výstup typický odhad překročit, takže se nástroj v hraničních případech nemusí
  zeptat, i když účet práh nakonec přeleze – proto rozsah s worst-case zůstává na očích.
- **Vstupní strop pro AI zvednut z ~240k na ~500k tokenů** (z 800 000 na 1 650 000 znaků).
  Velké projekty se tak do jednoho AI dotazu vejdou celé místo aby se uřízla zhruba půlka –
  u všech tří modelů (opus 4.8, sonnet 4.6, glm-5.2) je to i s výstupem pod 1M kontextem.
  Pozor: cena roste lineárně s velikostí kódu (proto odhad ceny výše), a velmi velký
  kontext může zhoršit přesnost mířených nálezů.
- **Který API klíč je potřeba, určuje nově zvolený model:** `glm` hlídá `ZAI_API_KEY`,
  `opus`/`sonnet` dál `ANTHROPIC_API_KEY`. Když klíč zvoleného modelu chybí, ale máš
  nastavený klíč jiného providera, hláška o přeskočení to napoví (např. „nalezen
  ZAI_API_KEY – přidej --ai-model=glm?"). Ověření přístupu `--ai-check` zůstává čistě
  na Anthropic.
- Přepínač **`--ai` byl přejmenován na `--ai-non-goal`** (analýza porušení non-goalů).
  Společně s novým `--ai-code` tvoří dva nezávislé AI režimy, které jdou zapnout
  i naráz – každý posílá vlastní dotaz na API (a má tedy vlastní cenu), ale čtení
  projektu proběhne jen jednou. `--ai-model` platí pro oba.
- Report (`.md` i JSON) nově ukazuje **všechny AI režimy odděleně** – non-goaly, kód
  i logika mají vlastní sekci, vlastní spotřebu tokenů i cenu. Strojový JSON index má
  **verzi 16**: pole `ai` je souhrn tří nezávislých výsledků (`nonGoal`, `code`, `logic`)
  a navíc nese `oversizedFiles` (soubory vynechané z AI kvůli per-file stropu).
  Změna tvaru pro konzumenty JSON.
- **Strop vstupu pro AI zvětšen z ~200 tisíc na ~800 tisíc znaků** (~240k tokenů), aby se
  do jednoho dotazu vešly i větší projekty, které se dřív usekávaly. Pozor: větší strop
  znamená i vyšší cenu jednoho běhu (a odhad ceny před během zatím chybí); u opravdu
  velkých projektů se výstup pořád může uříznout (řešením je budoucí dělení na části).

### Fixed

- **`--ai-model glm` na reálném projektu už neuřezává výstup.** `--ai-logic` (a další
  AI režimy) s glm dřív padaly na limit délky výstupu a čistě se přeskočily. Příčina:
  Z.ai jede ve výchozím stavu „reasoning_effort: max", takže model promyslel tolik, že
  na samotnou odpověď nezbylo místo; navíc náš plošný strop 16k tokenů glm stahoval
  pod reálný strop modelu. Nově je tvar dotazu **per-model** – glm dostává **128k strop
  výstupu** (131 072 tokenů, reálný strop GLM-5.2; dřívějších 65 536 byl jen výchozí
  hodnota Z.ai, ne strop) a explicitní „reasoning_effort: high" (GLM-5.2 vystavuje jen
  „high"/„max"; volíme „high" kvůli menšímu riziku, že přemýšlení sežere výstup),
  `opus`/`sonnet` zůstávají beze změny. Reálně ověřeno během na projektu.
- AI analýza posílala modelu vždy schéma pro non-goaly, takže `--ai-code` dostával
  od modelu nepoužitelný tvar odpovědi a tiše se přeskakoval. Každý režim teď posílá
  své vlastní schéma; chyba byla odhalena reálným během a pokryta testy.
- **Přetížené API a utnuté spojení už neprobublají jako „nečekaná chyba".** Když je
  Anthropic/Z.ai API přetížené (HTTP 529) nebo dočasně nedostupné (HTTP 503), případně
  když se streamované spojení během dlouhého dotazu přeruší (`terminated`), AI vrstva
  to teď zatřídí jako **čistě přeskočeno se srozumitelným důvodem** („API přetížené,
  zkus později" / „API je dočasně nedostupné…" / „síťová chyba…") místo výpisu stacku.
  Týká se obou cest – ověření přístupu (`--ai-check`) i samotné analýzy. Ostatní serverové
  chyby (HTTP 500/502) i programové chyby se záměrně dál hlásí se stackem, aby se reálný
  problém neschoval.

## [0.4.0] - 2026-06-20

### Added

- Report nově zahrnuje **AI vrstvu (logika a non-goaly)** – zatím jen bránu
  klíče. Před AI během se zjistí, jestli je k dispozici `ANTHROPIC_API_KEY`:
  bez klíče se sekce čistě označí jako „AI přeskočeno: chybí ANTHROPIC_API_KEY",
  s klíčem jako „připraveno" (reálné volání API přijde v další fázi). Hodnota
  klíče se nikdy nedostane do `.md` ani `.json`.
- Nový přepínač **`--ai-check`** pošle reálný testovací dotaz na Anthropic API
  (levný model) a ověří, že AI cesta funguje – v reportu se stav označí jako
  „AI ověřeno". Bez přepínače zůstává běh offline a zdarma (jen detekce klíče).
  Při síťové chybě, timeoutu nebo odmítnutém klíči se AI čistě přeskočí
  s konkrétním důvodem a nástroj doběhne (exit 0). Když klíč chybí, na stderr se
  vypíše, jak ho nastavit (proměnná prostředí nebo `node --env-file`). Hodnota
  klíče se nikdy nedostane do reportu ani na stderr.
- Nový přepínač **`--ai`** spustí reálnou **AI analýzu non-goalů**: vybraný
  zdrojový kód projektu se pošle na Claude (model přes **`--ai-model opus|sonnet`**,
  výchozí opus) a vrátí se nálezy porušení deklarovaných non-goalů, každý
  s odkazem na konkrétní místo v kódu (ověřené proti poslanému souboru – jinak
  označené „místo neověřeno"). Report i stderr ukážou **skutečnou spotřebu tokenů
  a odhad ceny**. Drahá cesta je opt-in; bez `--ai` se nic neposílá. Volání běží
  přes streaming (drží spojení živé u dlouhé analýzy) a bez retry – aby se
  nestalo, že u velkého projektu zaplatíš za výsledek, který klient zahodí.

### Changed

- Strojový JSON index má **verzi 13** – pole `ai` nově nese i variantu
  „analyzováno" (po `--ai`) s nálezy, spotřebou tokenů a cenou. Změna tvaru pro
  konzumenty JSON.

### Fixed

- `--out=` s **prázdnou hodnotou** (např. `vibeanalyzer . --out=`) nově vrátí
  chybu „Volba --out vyžaduje cestu k adresáři." místo aby report tiše zapsal do
  aktuálního adresáře. Chování je teď shodné s `--out` bez hodnoty.
- Zápis reportu už **nepřepíše ani nesmaže report z minulého běhu**, když zápis
  selže (plný disk, kvóta, I/O chyba). Soubory se nově zapisují přes dočasné
  `.tmp` a teprve po úspěchu obou se přejmenují na cílová jména; při chybě se
  uklidí jen dočasné soubory a původní report zůstane nedotčený.
- Dva běhy ve **stejné milisekundě** už **tiše nepřepíšou** report toho prvního.
  Když soubor s daným časovým razítkem už existuje, přidá se k názvu pořadové
  číslo (`vibeanalyzer-<razítko>-1.md` atd.), takže oba reporty zůstanou.
- Mermaid diagramy (strom struktury i graf modulů) nově **čistí jména souborů a
  složek jednotně a přísněji** – zpětník, backtick i konec řádku ve jméně už
  nerozbijí diagram ani neumožní podstrčit Mermaid syntaxi.

## [0.3.0] - 2026-06-20

### Changed

- Report nově **rozpozná monorepo s hoisted závislostmi** a hlášky „nenalezený
  modul" (TS2307) za takové situace nevydává za chybu kódu. Když v kořeni
  analyzované složky chybí `node_modules`, ale leží **výš** (typické pro monorepa,
  kde závislosti hoistnou o úroveň/víc nad balíček), a typová analýza zároveň reálně
  nahlásila aspoň jednu hlášku „nenalezený modul", přidá se upozornění, že tyto
  nálezy jsou nejspíš **artefakt analyzátoru** (čteme záměrně jen zadanou složku),
  ne chyba projektu. Poznámky jsou vzájemně výlučné – nikdy se neukáže současně
  „chybí node_modules" i „hoisted monorepo". Vědomé omezení v1: **pnpm** monorepo s
  lokálním symlinkovaným `node_modules` v balíčku se takto nerozpozná. JSON index
  proto povýšil na verzi 10 (`tsc.hoistedNodeModules`).
- Typová analýza (`tsc`) je teď **zavřená do kořene analyzovaného projektu**. Dřív
  mohl `import "../../něco"` nebo `/// <reference path="../../něco" />` ukrytý ve
  zdrojáku přimět TypeScript přečíst soubor **mimo** analyzovanou složku a vtáhnout
  jeho obsah do reportu (únik důvěrnosti / oťukávání souborového systému – ne spuštění
  cizího kódu, jen čtení). Nově dostává `tsc` vlastní „contained" hostitele, který
  čtení souborů propustí jen pod kořenem projektu (s rozpletením symlinků) a pod
  přibalenými typovými knihovnami; cokoli mimo se tváří jako neexistující a skončí
  hláškou „nenalezený modul", ne přečtením. Vědomý kompromis (bezpečnost > pohodlí):
  nad monorepem, kde závislosti leží o úroveň výš než analyzovaná složka, se report
  může zaplavit hláškami „nenalezený modul" – v této verzi analyzujeme striktně jen
  zadanou složku.

- Skener tajemství už **netiše nepřeskakuje balast**. Soubory, které z prohledávání
  vyřadí (minifikáty podle jména, velké > 1 MiB, binárky s NUL bajtem, soubory s
  extrémně dlouhým řádkem), report nově **počítá a explicitně uvádí** – řádek
  `Přeskočeno N souborů jako balast (minifikáty: …, velké: …, binárky: …, dlouhé
  řádky: …)` se zobrazí vždy, i s nulami. Stejná zásada „žádné tiché vynechání", jakou
  už zavedly ESLint vrstva a graf modulů. Vědomé omezení: I/O selhání (nečitelný
  soubor) se do těchto počtů netahá – není to filtr balastu, ale chyba čtení, kterou
  hlásí strom souborů zvlášť. JSON index proto povýšil na verzi 9 (`secrets.skipped`
  nese počty po kategoriích).
- Minifikáty (`*.min.js`, `*.min.css` apod.) report nově řeší **konzistentně napříč
  všemi sekcemi**, ne jen v ESLintu. Dřív jedna sekce bundle přeskočila a o pár řádků
  níž ho strom i počty zase vypsaly – report si protiřečil. Nově: počet souborů uvádí
  dovětek `(z toho M minifikátů)`, seznam souborů minifikát viditelně značí, graf
  modulů je z grafu vyřadí (nekreslí hrany do/z bundlu) a počítá je zvlášť, a souhrn
  i sekce grafu počet vyřazených hlásí. Rozhodnutí: minifikáty se **neskrývají, jen
  označí** – strukturální mapa dál ukazuje, co na disku fyzicky je. Rozpoznání zůstává
  v1 jen podle jména `*.min.<přípona>` (bundly bez té konvence jako `bundle.js` projdou
  – report to přiznává). Pozn.: skener tajemství minifikáty zatím skipuje bez vlastního
  počítadla (sjednocení i tam je v plánu). JSON index proto povýšil na verzi 8 (každý
  soubor nese příznak `minified`, graf modulů počítadlo vyřazených).
- Filtr minifikátů v ESLint vrstvě: minifikované soubory (`*.min.js`, `*.min.css`
  apod.) se už neposílají do ESLint analýzy. Dřív generovaný bundle zaplavil report
  falešnými nálezy (fatální „Parsing error" nebo desítky zásahů pravidel) o cizím,
  nepsaném kódu. Report počet přeskočených minifikátů uvádí explicitně – v sekci
  ESLint i v rychlém přehledu, takže „čistý" netají, že nějaké soubory linter vůbec
  neviděl. Omezení v1: rozpoznání je jen podle jména `*.min.<přípona>`, takže bundly
  bez té konvence (`bundle.js`) filtrem projdou a lintují se dál – report to přiznává.

### Added

- Graf modulů: report nově kreslí Mermaid diagram importních závislostí mezi
  zdrojovými soubory projektu (šipka A → B = „A importuje B"). Spolehlivé a lokální,
  bez AI – importy se vytahují parserem TypeScriptu (ne regexem), takže importy
  schované v komentářích/řetězcích nedělají falešné hrany a víceřádkové importy se
  trefí. Kreslí jen statické relativní importy (`import … from`, side-effect importy,
  `export … from`); dynamický `import()`/`require()`, externí balíky a `tsconfig`
  path-aliasy se nezobrazují (report to přiznává jako přibližnost). Klíčové: import
  s příponou `.js` se správně napojí na zdroj `.ts`/`.tsx`. Soubory bez jediné vazby
  se vypíšou jako „osamělé moduly", ne kreslí. Graf nad ~480 hran se ořízne (s
  poznámkou), aby nenarazil na tvrdý 500hranový limit Mermaidu a vůbec se vykreslil –
  úplné hrany zůstávají v JSON indexu. JSON index proto povýšil na verzi 7 (nese
  pole `moduleGraph`).
- Audit závislostí (volitelný, přepínač `--audit`): report nově hlásí zranitelné npm
  závislosti přes `npm audit` (balík, závažnost, CVE/GHSA, jestli existuje oprava).
  Je to síťová operace, proto se spustí jen na výslovné přání – bez `--audit` se
  vrstva přeskočí a výchozí běh zůstává offline. `--audit --dev` zahrne i vývojové
  závislosti (jinak jen produkční). Kvůli bezpečnosti se `npm audit` pouští nad kopií
  `package.json`+`package-lock.json` v dočasném adresáři s vynuceným oficiálním
  registry, takže se nepřečte `.npmrc` analyzovaného projektu (obrana proti
  přesměrování na cizí registry). Podporován je jen npm lockfile (ne yarn/pnpm);
  bez lockfilu nebo bez sítě se vrstva čistě přeskočí s konkrétním důvodem. JSON
  index proto povýšil na verzi 6 (nese pole `audit`).
- Strojové hledání tajemství: report nově hlásí pravděpodobné klíče a tokeny v kódu
  (privátní PEM klíče, AWS, GitHub, Google, Slack, Stripe) s odkazem na `soubor:řádek`.
  Skener čte i jinak ignorované soubory typu `.env`/`*.pem`/`id_rsa` u kořene projektu,
  přeskakuje binárky, velké soubory a minifikáty. Hledá záměrně jen známé tvary
  (radši míň, ale důvěryhodných nálezů), takže neznámé klíče může minout – sekce
  reportu na to upozorňuje. **Hodnota tajemství se do reportu nikdy nevypíše celá**,
  jen maskovaný náznak (např. `AKIA…`), aby commitovaný `.md`/JSON tajemství neunesl dál.
  JSON index proto povýšil na verzi 5 (nese pole `secrets`).

### Changed

- Vývojový test runner `vitest` povýšen z řady 2 (2.1.9) na 4.1.9. Šlo o major
  skok, protože 2.1.9 byla poslední verze řady 2 a žádný 2.x patch neexistoval.
  Bez dopadu na chování nástroje – mění se jen dev toolchain, publikuje se dál
  jen `dist/`. Celá testová sada (241 testů) zůstává zelená.
- Klíč adresáře projektu pod `~/.vibeanalyzer/` (kam se ukládá report i záměr) se
  nově odvozuje pomocí SHA-256 místo SHA-1. Jde o úklid kvůli bezpečnostnímu
  skeneru, ne o reálnou bezpečnostní díru – hash tu jen tvoří krátký deterministický
  klíč z cesty, nechrání žádná citlivá data. Pozor: protože se klíč změnil, projekty
  analyzované starší verzí dostanou pod `~/.vibeanalyzer/` novou složku a dříve
  uložené reporty/záměry zůstanou pod původním (starým) klíčem jako osiřelé. Tvar
  klíče (`jméno-složky-<8 hex>`) i chování jinak zůstávají stejné.

### Security

- Odstraněn kritický supply-chain nález CVE-2026-47429 (path traversal ve Vitest
  UI serveru) povýšením `vitest` na 4.1.9. Zranitelnost se týkala jen řady 2.x a
  v projektu byla i tak nedosažitelná (`@vitest/ui` se neinstaluje, test runner je
  dev-only a nepublikuje se). `npm audit` nově hlásí 0 zranitelností.

### Fixed

- Izolovaný běh strojové vrstvy (`tsc`/ESLint ve forku) už **nehromadí chybový výstup
  dítěte bez stropu**. Patologicky upovídaný podproces mohl po celou dobu timeoutu
  (120 s) nafukovat paměť rodiče zápisem na stderr – vedlejší kanál, kterým mohl
  navzdory izolaci nástroj udusit. Stderr se nově ořezává na posledních 64 KiB.
  Záměrně se drží **konec** výstupu, ne začátek: signatura docházející paměti
  (`FATAL ERROR … heap out of memory`) přichází až těsně před pádem, takže ořezání
  od začátku by ji zahodilo a běh by se chybně oznámil jako obecný pád místo „došla
  paměť".

- Nálezy auditu závislostí teď **ukazují na skutečný lockfile**. Když projekt používá
  `npm-shrinkwrap.json` (ne `package-lock.json`), report dřív natvrdo odkazoval na
  `package-lock.json`, který v projektu vůbec není. Nově se jméno auditovaného
  lockfilu propíše do každého nálezu.

- Počty zranitelností v reportu auditu už **nelžou, když chybí souhrnná metadata**.
  Ve výjimečném výstupu `npm audit` bez sekce `metadata` report dřív vypsal „N
  zranitelností (kritických 0, vysokých 0, …)" – součet kategorií neseděl s celkem.
  Počty po závažnosti se nově dopočítají přímo z nalezených zranitelností, takže
  součet vždy odpovídá celku.

- Rozpis auditu už **zobrazuje i kategorii „informativní"**. Dřív věta „npm audit
  našel N zranitelností" vypsala jen kritické/vysoké/střední/nízké, ale informativní
  nálezy se sice do celku `N` počítaly, ve výpisu chyběly – při `info > 0` pak součet
  zobrazených kategorií neseděl s celkem. Nově je `informativních` součástí rozpisu,
  takže čísla vždy sednou.

## [0.2.0] - 2026-06-19

### Changed

- Strojová typová analýza (tsc) běží na přibaleném TypeScriptu 6.0.3 (povýšeno z 5.9).
  Záměrně se nenačítá (a tedy nespouští) TypeScript z `node_modules` analyzovaného
  projektu – vždy se použije přibalený, čímž nástroj drží slib „čte, nespouští" i pro
  tuhle vrstvu. Verzi TypeScriptu projektu jen přečte z jeho `package.json` a když se
  liší, report u tsc poznamená, kterou verzí se typovalo a kterou projekt používá.
  Povýšení na 6.0 drží nástroj na aktuální stabilní řadě před příchodem nativního
  TypeScriptu 7 a je bez dopadu na chování (build, typecheck i celá testová sada
  zelené, tvar nálezů beze změny). Pozor: u analyzovaných projektů bez explicitní
  konfigurace `tsconfig` (nové výchozí hodnoty 6.0 – strict, novější knihovna) se může
  report o něco více lišit od toho, co by nahlásil jejich vlastní toolchain – proto je
  výše uvedená poznámka o verzním rozdílu důležitější než dřív.

### Security

- Typová analýza (tsc) už nepřečte soubory mimo analyzovaný projekt, i když na ně
  podvržený `tsconfig.json` cílí. Dřív mohl klonovaný cizí repozitář přes `files`/
  `include` (cesty s `../` nebo absolutní), přes `extends` nebo přes symlink uvnitř
  projektu mířící ven donutit nástroj přečíst libovolný soubor na disku a vtáhnout
  jeho obsah/cestu do reportu (sondování souborového systému). Teď se takové cesty
  vynechají z analýzy a nahlásí jako varování v reportu; když na ně tsconfig míří
  jen na soubory mimo projekt, vrstva se přeskočí s pravdivým důvodem. (Zbývá známé
  omezení: `import`/`/// <reference path>` uvnitř zdrojáků zatím mimo tohle zadržení.)

- Název souboru v reportu se sanitizuje i proti zalomení řádku (CR/LF), ne jen proti
  zpětnému apostrofu. Soubor se zákeřným jménem (na Linuxu smí obsahovat newline) už
  nerozbije odrážku ani nepodstrčí do MD reportu falešný nadpis.

### Added

- Strojová lint analýza (ESLint): nástroj projede JS/TS soubory projektu (jen je
  čte/parsuje, kód projektu nespouští ani nic nezapisuje) a hlásí pravděpodobné
  bugy, které typová kontrola nevidí – `==` místo `===`, prázdný `catch`,
  zapomenutý `debugger`, omylem přiřazení v podmínce, duplicitní klíče, nedosažitelný
  kód, `switch` bez `break`. Nálezy jsou v nové sekci „Strojové
  nálezy (ESLint)" v MD i v poli `eslint` JSON indexu, se `soubor:řádek:sloupec`,
  závažností, pravidlem a zprávou. Z bezpečnostních důvodů se používá pevný ruleset
  vibeanalyzeru (jen pravidla na bugy, žádný styl) a projektový `eslint.config.js`
  se záměrně nenačítá (jeho spuštění by znamenalo spustit cizí kód). Když projekt
  nemá JS/TS soubory, vrstva se čistě přeskočí. Nálezy nemění návratový kód.

- Strojová typová analýza (tsc): nástroj pustí TypeScript kompilátor v režimu
  kontroly (jen čte, nic nespouští ani nezapisuje do projektu) nad analyzovaným
  projektem a typové chyby zapíše do reportu jako `soubor:řádek:sloupec` se
  závažností, kódem (např. `TS2322`) a zprávou – v nové sekci „Strojové nálezy
  (tsc)" v MD i v poli `tsc` JSON indexu. Report odlišuje tři stavy: nálezy /
  čistý projekt (0 chyb) / přeskočeno (s důvodem) – „čistý" se neplete s
  „neproběhlo". Když projekt nemá `tsconfig.json` nebo je rozbitý, vrstva se čistě
  přeskočí (report nespadne). Chyby konfigurace (např. `extends` na neexistující
  soubor, neznámá volba) se hlásí jako nálezy, ne tiše zahodí. Když v projektu
  chybí `node_modules`, report to přizná (chyby „nenalezený modul" jsou za té
  situace očekávané). TypeScript se bere z `node_modules` projektu (jeho verze),
  jinak z přibaleného. Nálezy v analyzovaném projektu nemění návratový kód.

### Changed

- Mermaid diagram struktury složek se kreslí zleva doprava (`graph LR`) místo
  shora dolů. Sourozenecké složky se teď skládají pod sebe, takže graf roste do
  výšky a ne do šířky – u projektů s mnoha složkami je čitelnější. Zároveň se
  zvedl strop vykreslených uzlů z 60 na 1000, takže i projekt se stovkami složek
  se v diagramu zobrazí celý (ověřeno na 1100 souborech / 343 adresářích). Nad
  1000 uzlů se diagram dál poctivě ořízne s poznámkou, kolik z kolika složek je
  vidět.

- Strojová analýza (tsc i ESLint) teď běží v odděleném podprocesu s limitem paměti
  a časovým limitem. Na obřím projektu, kde by dřív mohla vyčerpat paměť (a shodit
  celý nástroj) nebo se zaseknout, se místo pádu čistě označí jako přeskočená
  s konkrétním důvodem („příliš velký projekt", „trvalo příliš dlouho") – report
  vždy vznikne. Cena: každý běh má kvůli izolaci o ~1–2 s vyšší režii.

- JSON index má nově verzi 4 (přibyla pole `tsc` a `eslint` s výsledky strojových analýz;
  tsc výsledek nese i verzi použitého TypeScriptu, případně verzi deklarovanou projektem).

- Když záměr projektu (`project.md`) nikde není a nástroj běží v terminálu, nabídne
  jeho vytvoření: pár otázek (co stavíš + non-goaly), uloží `project.md` do
  `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/` a rovnou ho použije pro tenhle
  report. Do analyzovaného projektu se nic nezapisuje. Při běhu bez terminálu
  (pipe, CI, přesměrování) se nástroj na nic neptá a chová se jako dosud (vypíše
  jen tip, jak záměr dodat ručně). Vytvoření záměru nikdy neshodí samotný report –
  i když se uložení nepovede, report přesto vznikne.

- CLI `vibeanalyzer [cesta] [--out <dir>]`: projde strom projektu a vygeneruje
  strojový JSON index a lidský MD report s Mermaid diagramem struktury (jen složky).
- Procházení přeskakuje pomocné složky (`node_modules`, `.git`, `.mini`, `dist`,
  `build`), nesleduje symlinky a nečitelné soubory přeskočí a zaznamená do reportu.
- Výchozí výstup do `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/` (lze přepsat
  přes `--out`), názvy souborů nesou časové razítko (nepřepisují předchozí běhy).
  Hash v názvu složky odděluje projekty se stejným jménem z různých cest, takže si
  navzájem nepřepíšou výstup.
- Report v hlavičce uvádí záměr projektu a deklarované non-goaly načtené z
  `.mini/project.md` (případně `project.md`) analyzovaného projektu, a nově i z
  `~/.vibeanalyzer/<jméno projektu>-<hash cesty>/project.md` (společná složka s
  výstupem) jako třetí zdroj v pořadí. Záměr je volitelný: když chybí nebo je
  prázdný, report normálně doběhne, uvede explicitní „záměr nedodán" a poradí, jak
  ho dodat. Nečitelný soubor jen ohlásí varováním. Nástroj do analyzovaného
  projektu nic nezapisuje.
- Procházení respektuje `.gitignore` analyzovaného projektu, a to nejen kořenový,
  ale i vnořené v podsložkách: co Git ignoruje (u Symfony typicky `vendor/`,
  `var/cache/`) se do indexu nezahrne a do ignorovaných složek se vůbec nevstupuje.
  Vnořená pravidla platí pro svůj podstrom, hlubší má přednost před mělčím a
  funguje i re-include přes `!` (např. `*.log` v `src/` a `!keep.log` v `src/sub/`).
  Chybějící `.gitignore` nic nemění; nečitelný nebo patologický (příliš dlouhá
  řádka či příliš velký soubor) se ohlásí varováním a procházení pokračuje bez
  pravidel té jedné složky. Když `.gitignore` odfiltruje úplně všechny soubory,
  report přesto vznikne, ale upozorní, že není co analyzovat.

### Fixed

- ESLint vrstva už nehlásí falešný „Parsing error" na zdravém JSX. Validní `.jsx`
  a `.js` se syntaxí JSX (typicky React) se teď korektně naparsují místo toho, aby
  skončily jako falešný `error` nález na řádku 1. Zároveň se přestaly vypisovat
  falešné nálezy „nepoužitá proměnná" na importech komponent a React pragmě
  (jádrový lint JSX použití nevidí); detekce nepoužitých proměnných je proto
  vypnutá – ostatní kontroly bugů běží beze změny.
- Výstupní adresář ležící uvnitř analyzované složky se už nezapočítá do indexu –
  a to i když je zadán přes symlink (jinak by report rostl každým během).
- Položky neznámého/zvláštního typu (na souborových systémech bez `d_type`, dále
  fifo/socket/zařízení) se už tiše nezahazují – zaznamenají se mezi přeskočené.
- Při selhání zápisu reportu (např. plný disk) nezůstane na disku osiřelý částečný
  výstup; nástroj uklidí jen to, co sám kvůli zápisu vytvořil (včetně zanořených
  adresářů), nikdy ne předem existující cizí adresář, a vrátí jasnou chybu.
- Když cílová složka mezi kontrolou a průchodem zmizí nebo přestane být čitelná,
  nástroj vrátí chybu a nenulový kód místo tichého prázdného reportu (dřív vypadal
  jako úspěch). Legitimně prázdná složka je dál v pořádku.
- Chybové cesty CLI (neplatný cíl, nevytvořitelný výstupní adresář, selhání zápisu)
  spolehlivě končí nenulovým kódem s konkrétní hláškou, ne pádem ani tichým úspěchem.
- Non-goal zadaný při tvorbě záměru s vedoucí odrážkou (např. „- Nespouštět kód")
  se ve vygenerovaném `project.md` už nezobrazí se zdvojenou odrážkou („- - …").
- Interaktivní dotaz na záměr po sobě vždy spolehlivě zavře vstup, takže se proces
  po zodpovězení otázek nezasekne – i kdyby vlastní běh skončil chybou.
