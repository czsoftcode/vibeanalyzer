# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 1-1 · should-know · resolved
**Where:** src/cli.ts:57
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Výstupní adresář vytvořený uvnitř scanovaného stromu se započítá do indexu

mkdir(outDir) na ř.57 běží PŘED scanTree() na ř.68. Když uživatel zadá --out na cestu uvnitř analyzované složky (např. 'vibeanalyzer . --out ./reports'), čerstvě vytvořený výstupní adresář se objeví v indexu jako dir záznam. Reprodukováno: scan T s --out T/reports → JSON obsahuje {path:'reports'}. Vlastní *.json/*.md artefakty jsou filtrované regexem podle jména, ale SAMOTNÁ výstupní složka ne → index zkresluje strukturu projektu složkou, kterou tam nástroj sám vytvořil. Oprava: scanovat před mkdir, nebo skip outDir, je-li uvnitř root.

## 1-2 · should-know · resolved
**Where:** src/scan.ts:64-92
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Dirent s neznámým typem (DT_UNKNOWN) se tiše zahodí, nezaznamená do skippedUnreadable

Smyčka větví jen na isSymbolicLink/isDirectory/isFile. Na souborových systémech, které z readdir nevracejí d_type (některé overlayfs v Dockeru, NFS, FUSE), Dirent.isFile()/isDirectory()/isSymbolicLink() vrátí VŠECHNY false → záznam nespadne do žádné větve a komentář 'ostatní typy ignorujeme' ho zahodí. Soubor/složka tím zmizí z indexu BEZ jakékoli stopy (ani v skippedUnreadable). To přímo boří jádro nástroje (úplný strukturální index) a selhává TIŠE — uživatel nepozná, že mu chybí soubory. Lokálně těžko reprodukovatelné (ext4/btrfs/apfs d_type vracejí), ale na overlayfs reálné. Oprava: při neznámém typu udělat lstat(abs) a rozhodnout podle něj, nebo nerozpoznané zaznamenat do skippedUnreadable.

## 1-3 · should-know · resolved
**Where:** src/cli.ts:81-88
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Při selhání zápisu MD zůstane na disku osiřelý JSON (částečný výstup)

writeFile(jsonPath) a writeFile(mdPath) běží sekvenčně v jednom try. Když JSON projde a MD selže (plný disk, ENOSPC, odebraná práva mezi tím), JSON už leží na disku; funkce vrátí exit 1, ale osiřelý vibeanalyzer-<stamp>.json zůstane bez párového .md. Žádný cleanup/rollback. Uživatel vidí 'Chyba', ale v adresáři má polovičatý výstup, který může omylem považovat za platný. Mírná závažnost (vzácný stav), ale je to tiché zanechání nekonzistence. Zvážit: zapsat oba do temp a atomicky přejmenovat, nebo při chybě smazat již zapsaný JSON.

## 1-4 · nit · open
**Where:** src/report/markdown.ts:19-21
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
escapeLabel ošetřuje jen uvozovky a hranaté závorky, ne další Mermaid-citlivé znaky

escapeLabel nahradí jen " a odstraní [ ]. Reálný název složky ale může obsahovat další znaky, které Mermaid v ['...'] labelu interpretuje: '#' (začátek HTML entity jako #9829;), zpětný apostrof, a na Linuxu i znak nového řádku (filename smí obsahovat cokoli kromě '/' a NUL). Reprodukováno, že '(' '|' '{}' projdou neescapované (v quoted labelu zřejmě OK), ale '#'/newline můžou rozbít nebo zkomolit diagram. Nízká závažnost (vzácné názvy), ale escaping je neúplný a selže nehlučně = nevalidní mermaid blok v reportu. Pokrytí testem 0 (markdown.test.ts neřeší žádný speciální znak).

## 1-5 · nit · open
**Where:** src/timestamp.ts:6-8, src/cli.ts:66
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
Shoda časového razítka v jedné ms tiše přepíše předchozí výstup

fileTimestamp má rozlišení na milisekundy. Report tvrdí, že soubory se kvůli razítku 'jen koexistují, nepřepíšou'. To platí jen mezi různými ms. Dvě dostatečně rychlé/skriptované běhy do téhož outDir ve stejné ms vyrobí identické jméno vibeanalyzer-<stamp>.json/.md → druhý writeFile tiše přepíše první bez varování. V praxi vzácné (sekvenční CLI), ale tvrzení v reportu je nepřesné a kolize je tichá.

## 1-6 · nit · open
**Where:** src/args.ts:45-47
**Reviewed-at:** cfb68eb76b2892c3327fda3b6f3be9dcefc02941
**Source:** adversarial
--out= (prázdná hodnota) tiše zapíše do CWD místo chyby

Větev '--out='.slice() vrátí prázdný řetězec; ten v cli projde do path.resolve(cwd, '') = cwd. Takže 'vibeanalyzer . --out=' tiše vysype výstupy do aktuální složky, přestože uživatel zjevně chtěl zadat cestu a nechal ji prázdnou. Konzistentní by bylo vrátit stejnou chybu jako '--out bez hodnoty'. Nízká závažnost, ale překvapivé a netestované.
