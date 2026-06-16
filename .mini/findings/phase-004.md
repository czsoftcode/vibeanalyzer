# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 4-1 · should-know · resolved
**Where:** src/intent.ts:101
**Reviewed-at:** 6b9639b915f675b29935811613cbc1c0cc9dbb20
**Source:** adversarial
parseIntent tiše uřízne sekci na řádku začínajícím '#' v těle prózy

Ukončovací regex /^#{1,6}\s/ v sectionLines() nerozliší skutečný předěl sekce od řádku, který jen začíná '#'+mezera uvnitř volné prózy. Sekce 'What I'm building' je text psaný člověkem a běžně obsahuje příklad jako '# vibeanalyzer ./src' nebo markdown nadpis. OVĚŘENO: vstup '## What I'm building / A CLI tool. Example invocation: / # vibeanalyzer ./src / It then scans...' → building='A CLI tool. Example invocation:' a zbytek (i ten '#' řádek) tiše zmizí. Žádný pád, ale do reportu se dostane jen půlka záměru a člověk to nepozná. Přesně ta tichá kaskáda, před kterou varuje CLAUDE.md. Autor zdokumentoval jen variantu nadpisu s tabem, tuhle ne.

## 4-2 · should-know · resolved
**Reviewed-at:** 6b9639b915f675b29935811613cbc1c0cc9dbb20
**Source:** adversarial
parseIntent nezná code fence: nadpis uvnitř bloku/ ## Non-goals / - fake from code block /  a 'Real prose' se ztratí; navíc extractList by 'Non-goals' vytáhl z příkladu v code bloku. Bezpečná degradace (nepadá), ale do reportu jde špatný/neúplný obsah. Reálné, protože project.md s příklady je běžný. Stejný kořen jako 4-1 (parser není markdown-aware).

## 4-3 · should-know · resolved
**Where:** src/intent.ts:86-105
**Reviewed-at:** 6b9639b915f675b29935811613cbc1c0cc9dbb20
**Source:** adversarial
parseIntent nezna code fence: nadpis uvnitr fenced bloku v project.md se bere jako realna sekce (POZN: nahrazuje zmrsenou 4-2)

POZN: finding 4-2 vznikl spatne (backticky v shellu spustily substituci, telo i --where se ztratily) - 4-2 ignorujte, plati tento zaznam. sectionLines() jen splituje radky a hleda nadpis '## <heading>' resp. ukoncovaci '#', NEsleduje stav code fence (trojity backtick ani ~~~). Kdyz project.md cituje priklad jineho project.md uvnitr fenced bloku, nadpis '## Non-goals' nebo '## What I am building' zevnitr bloku se detekuje jako prava sekce. OVERENO sondou: dokument se sekci 'What I am building', jejiz telo cituje fenced blok obsahujici '## Non-goals / - fake', skonci tak, ze building se ureze na oteviraci fence a nasledna prava proza 'Real prose.' se ztrati; navic extractList vytahne 'Non-goals' z prikladu uvnitr code bloku. Bezpecna degradace (nepada), ale do reportu jde spatny/neuplny obsah. Realne, protoze project.md s priklady je bezny. Stejny koren jako 4-1 (parser neni markdown-aware).

## 4-4 · should-know · resolved
**Where:** src/intent.ts:53-63
**Reviewed-at:** 6b9639b915f675b29935811613cbc1c0cc9dbb20
**Source:** adversarial
Prazdny/skeletovy .mini/project.md tise zastini vyplneny root project.md

loadIntent vraci PRVNI kandidat, ktery se da PRECIST, ne prvni s obsahem. Kdyz v projektu existuje .mini/project.md jen jako prazdna kostra (napr. nadpisy sekci bez textu, coz muze zalozit mini), precte se uspesne → kind=loaded, ale building i nonGoals=null → report ukaze 'nedodano', i kdyz uzivatel vyplnil zamer do root project.md. Precedence je dana existenci souboru, ne obsahem. Uzivatel, ktery vyplni 'spatny' soubor, dostane tichou degradaci bez varovani. Neni to pad, ale je to dalsi ticha cesta k 'nedodano'. Nizsi jistota (zalezi, jak presne mini scaffolduje project.md), proto should-know, ne blocker.

## 4-5 · nit · resolved
**Where:** src/report/markdown.ts:54
**Reviewed-at:** 6b9639b915f675b29935811613cbc1c0cc9dbb20
**Source:** adversarial
Novy radek ve sourcePath rozbije inline code span hlavicky reportu

intentSection osetruje backtick v sourcePath (nahrada apostrofem), ale ne novy radek. Na Linuxu muze adresar obsahovat '\n' ve jmenu; targetPath jde z argv a sourcePath se z nej odvodi. Radek 'Nacteno z <path>.' by se pak prelomil pres dva radky a druhy radek by vypadl z inline code spanu jako syrovy text. Velmi exoticke (newline ve jmene slozky), proto nit; pro uplnost ke stejne tride obrany jako backtick.
