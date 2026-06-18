# Phase 12 — Strojová analýza: tsc nálezy

## Intent
Report je dnes čistě popisný (strom, struktura, záměr). Tahle fáze přidává PRVNÍ
skutečné nálezy: pustí TypeScript kompilátor v režimu typové kontroly (nic
nespouští) nad analyzovaným projektem a typové chyby zapíše do reportu jako
`soubor:řádek` + závažnost + TS kód + zpráva. Zároveň zavede sdílený datový tvar
"strojového nálezu", na který se později nabalí ESLint (viz todo) i AI vrstva.

## Key decisions
- **Původ tsc: HYBRID.** Použít TypeScript z `node_modules` analyzovaného projektu,
  když tam je (přesně jeho verze); jinak náš přibalený. → typescript musí přejít
  z devDependencies do **dependencies** (kvůli fallbacku v nainstalovaném balíčku).
- **NIKDY neinstalovat (`npm install`).** Padlo to jako návrh (sandbox/docker) a bylo
  ZAMÍTNUTO: `npm install` spouští lifecycle skripty projektu i všech jeho závislostí
  = porušení non-goalu č. 1 ("nespouštět analyzovaný kód") + potřebuje síť (proti
  "doběhne i bez internetu"). Docker by jen izoloval, ale kód stejně spustí. Out of scope.
- **Chybějící `node_modules` se detekuje a ČESTNĚ přizná v reportu:** "tsc běžel bez
  nainstalovaných závislostí – chyby typu 'nenalezený modul' (TS2307 apod.) jsou
  očekávané, ne nutně bug." Aby si vibekodér nemyslel, že má projekt rozbitý.
- **Soubory bere tsc z jejich `tsconfig`** (jeho include/exclude), ne z našeho scanu.
  Cesty v nálezech přepočítat relativně ke kořeni (oddělovač "/") jako zbytek reportu.
- **Jen kořenový `tsconfig.json`** v cíli. Monorepo s víc configy = později.
- **Velký projekt: bez limitu, jen varování.** Před během vypsat "spouštím tsc nad N
  soubory, může chvíli trvat". ŽÁDNÝ timeout (synchronní běh nejde čistě přerušit;
  worker+timeout = overkill pro V1). Vědomě přijaté riziko, že u obřího monorepa visí.
- **Nová sekce "## Strojové nálezy" (tsc)** do `.md` + pole `findings` do JSON indexu.
  → **bump `INDEX_VERSION` (1 → 2)**, mění se tvar JSON – pohlídat jako kontrakt.

## Watch out for
- **"tsc našel 0 chyb" ≠ "tsc přeskočeno".** Tyhle stavy se NESMÍ slít do "v reportu
  nic není" (tichý falešný úspěch dle CLAUDE.md). Report musí vždy ukázat, který stav
  nastal: "tsc: X nálezů" / "tsc: čistý (0 chyb)" / "tsc: přeskočeno (důvod)".
- **Nálezy v cizím projektu NEMĚNÍ exit kód.** I 50 typových chyb = úspěšný běh
  vibeanalyzeru (exit 0). Exit ≠ 0 jen když selže sám vibeanalyzer.
- **Některé tsc diagnostiky nemají soubor/řádek** (globální chyby configu) → model
  nálezu musí mít `file`/`line` jako VOLITELNÉ, jinak na nich spadneme.
- **Rozbitý/nenaparsovatelný `tsconfig`** = přeskočení s jasnou hláškou, ne pád, ne mlžení.
  Rozlišit "není tsconfig (není TS projekt)" vs "tsconfig je, ale rozbitý".
- **Žádný `tsconfig.json`** v kořeni → "tsc přeskočeno", NE nález, NE pád.
- tsc nesmí zapisovat do analyzovaného projektu (`noEmit`, žádné `tsBuildInfo`) – non-goal č. 1.
- Skutečnost, že tsc nespouští kód: createProgram + getPreEmitDiagnostics jen typuje;
  language-service pluginy (editor-only) se nespouští → bezpečné.

## Verification
Schválně vložená typová chyba se objeví v reportu na správném `soubor:řádek`;
projekt bez `tsconfig` dá "tsc přeskočeno" (ne pád).
