# Phase 12 — Strojová analýza: tsc nálezy

**Goal:** Zavést datový model strojového nálezu (soubor:řádek:sloupec, závažnost, pravidlo, zdroj) a sekci "Strojové nálezy" do .md i JSON indexu, a naplnit ji diagnostikou z tsc puštěného nad analyzovaným projektem; když projekt nemá tsconfig/není TS nebo je config rozbitý, vrstva se čistě přeskočí (ne pád). Ověření: schválně vložená typová chyba se objeví v reportu na správném soubor:řádek; projekt bez tsconfig dá "tsc přeskočeno".

## Steps
- [done] Datový model nálezu + tsc-result typ
- [done] Sekce Strojové nálezy v md + findings v JSON
- [done] Hybridní načtení TypeScriptu + přesun do dependencies
- [done] tsc analyzátor: tsconfig -> diagnostika -> Finding[]
- [done] Napojení do run() + hláška o rozsahu
- [done] Adversariální self-review (sub-agent) + finální kontrola

## Auto-commit
- Phase 12: Strojová analýza: tsc nálezy

## Discussion
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

## Run report
---
phase: 12
verdict: done
steps:
  - title: "Datový model nálezu + tsc-result typ"
    status: done
  - title: "Sekce Strojové nálezy v md + findings v JSON"
    status: done
  - title: "Hybridní načtení TypeScriptu + přesun do dependencies"
    status: done
  - title: "tsc analyzátor: tsconfig -> diagnostika -> Finding[]"
    status: done
  - title: "Napojení do run() + hláška o rozsahu"
    status: done
  - title: "Adversariální self-review (sub-agent) + finální kontrola"
    status: done
verify:
  - title: "Reálný běh nad cizím JS/TS projektem (vizuální kontrola reportu)"
    detail: "Testy i ad-hoc běhy ověřeny strojově (185 testů zelených, e2e najde úmyslnou TS2322 na správném řádku). Co jsem NEzkoušel: běh nad velkým reálným projektem s nainstalovaným node_modules (source 'project', desítky nálezů, čitelnost sekce v GitHub/VS Code náhledu) a nad projektem s pnpm symlinky."
---

# Phase 12 — report z auto session

## Co se povedlo
Report má první skutečné nálezy: tsc (jen type-check, nic nespouští) píše do nové
sekce `## Strojové nálezy (tsc)` v `.md` i do pole `tsc` v JSON indexu (verze 2).
Všech 6 kroků hotových, 185 testů zelených, typecheck i build čistý.

Klíčová rozhodnutí podle diskuse drží:
- **Hybridní tsc** (`src/analyze/loadTypescript.ts`): verze z `node_modules` cíle, fallback na přibalený. `typescript` přesunut do `dependencies`.
- **Nikdy neinstaluje**, NIKDY nezapisuje do projektu – ověřeno během s `composite/incremental/tsBuildInfoFile/outDir`: po analýze ve složce nevznikl žádný `.tsbuildinfo` ani `dist` (vynucený `noEmit` + vypnutý incremental/composite).
- **Tři stavy odlišitelně**: "N nálezů" / "čistý (0)" / "přeskočeno (důvod)". "ran s 0" se neplete se "skipped" ani v md, ani v JSON.
- **Nálezy nemění exit kód** (i 50 typových chyb = exit 0); chybové cesty vibeanalyzeru dál vrací exit 1.
- Chybějící `node_modules` se v reportu čestně přizná (chyby "nenalezený modul" jsou očekávané).

## Co našel adversariální sub-agent (a co jsem opravil)
Pustil jsem nezávislého sub-agenta (čerstvý kontext) dle CLAUDE.md. Našel 1 reálný
must-fix + 2 související should-know, všechny opraveny a pokryty regresními testy:

1. **(must-fix) Tichý falešný úspěch:** chyby konfigurace (`extends` na neexistující soubor, neznámá volba) se zahazovaly, když tsconfig zahrnul aspoň jeden soubor → report tvrdil "0 nálezů" nad rozbitým configem. Fix: `cmd.errors` (kromě TS18003) se teď mapují do nálezů i v "ran" větvi. Testy: TS5083, TS5023.
2. **(should-know) Lživý důvod:** prázdný tsconfig hlásil "chyba konfigurace", i když jen nebyly soubory. Fix: TS18003 oddělen jako stav → reason "tsconfig nezahrnul žádné soubory". Test přidán.
3. **(should-know) pnpm:** symlinkované `node_modules` → verze TS projektu se nikdy nepoužila (guard porovnával nerozbalenou cestu proti realpath z `require.resolve`). Fix: hranice se počítá z `realpath(node_modules)`.
4. **(nit) Catch v `run()`** nově vypisuje stack (ne jen message) – programovou chybu v mapování aspoň poznáme ze stderr, i když report neshazujeme.
5. **(nit) Backtick v cestě** souboru by rozbil inline code span → v `renderFinding` se nahradí.

## Známá omezení (vědomá, V1)
- **Bez timeoutu** u tsc (dle diskuse): u obřího monorepa může běh viset. Před během se vypíše "spouštím tsc nad N souborů".
- Catch kolem analyzátoru maskuje i programové chyby jako "tsc selhal" (ale nahlas na stderr se stackem). Vědomý kompromis: report nemá kvůli bugu v mapování spadnout.
- Jen kořenový `tsconfig.json`. Monorepo s víc configy = později.

## Pozn. pro další krok
Padlo rozhodnutí zamítnout `npm install`/sandbox/docker (spouští cizí kód = porušení non-goalu) – už zaznamenáno v `.mini/discuss/phase-012.md`. Není potřeba `/mini:decision`.
ESLint vrstva (druhá půlka původní todo 3) čeká v `mini todo`.
