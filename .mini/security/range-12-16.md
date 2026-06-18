# Security review — range 12–16 (strojová vrstva: tsc + ESLint)

- **Range:** `git diff bd56573afee1ca2792cd679535fdf233678a4189..c145b29b6823eb89d88a4bb0d2c89e96f72273d4`
- **Reviewed at:** HEAD `c145b29` (Phase 16)
- **Method:** Bezpečnostní průchod sinky zavedenými v tomto rozsahu, ne řádek po řádku.
  Zaměřeno na: (1) spouštění procesů (`fork`, tsc/ESLint API), (2) čtení/zápis na FS
  steerovaný cizím vstupem, (3) parsování cizího `tsconfig.json`/zdrojáků, (4) průtok
  cizího obsahu do reportu, (5) novou závislostní plochu. Klíčová obranná tvrzení
  (že tsc/ESLint cizí kód NEspouštějí) jsem ověřoval proti chování knihoven, ne jen
  podle komentářů v kódu; `overrideConfigFile: true` ověřeno proti dokumentaci ESLint 9.
- **Threat model:** `mini`/vibeanalyzer je lokální CLI bez síťového listeneru a bez
  ukládání tajemství. Reálně nepřátelský vstup v tomto rozsahu je **obsah klonovaného
  cizího projektu**: jeho `tsconfig.json`, názvy souborů a zdrojový kód. Nová strojová
  vrstva (tsc + ESLint) běží NAD tímto cizím vstupem. Centrální bezpečnostní invariant
  rozsahu je non-goal č. 1 „neanalyzovaný kód NEspouštět“ — tj. žádné vyhodnocení cizího
  JS (projektový `eslint.config.js`, `require("typescript")` z cizích `node_modules`).
  Zápis do cíle se nekoná (vynucený `noEmit`, `fix:false`). Výstupem je lokální `.md`/`.json`
  report; AI vrstva (prompt s tool-accessem) v tomto rozsahu NEexistuje, přijde později.

## Verdict
Bez blockerů. Jádrová obrana proti spuštění cizího kódu je promyšlená a drží. Tři nálezy:
jeden **should-know** (čtení libovolného souboru mimo repo přes podvržený `tsconfig.json`),
dva **nit** (asymetrie sanitizace v reportu; rozšíření závislostní plochy).

## Findings

### SEC-1 · should-know · Čtení libovolného souboru mimo repo přes podvržený `tsconfig.json`
**Where:** `src/analyze/tsc.ts:55–58` (`parseJsonConfigFileContent` + následné `ts.createProgram(cmd.fileNames, …)`)

`tsconfig.json` je plně pod kontrolou útočníka (je v klonovaném repu). TypeScript při
`parseJsonConfigFileContent` rozbalí `extends` (čte odkazovaný soubor) a do
`cmd.fileNames` zařadí cesty z `files`/`include`. Pole `files` (i `extends`) přijímá
**absolutní cesty i `../`** a TS je resolvuje relativně ke `configDir` bez omezení na
kořen projektu. `createProgram` pak ty cesty **čte z disku**. Konkrétní cesta:

1. naklonuji repo s `tsconfig.json` obsahujícím např. `"files": ["../../../../../../etc/hostname"]`
   (nebo `"extends": "/absolutní/cesta"`),
2. uživatel spustí vibeanalyzer nad tím repem,
3. tsc soubor mimo repo přečte; jeho **cesta** (relativizovaná na `../../../etc/...`) a
   tsc diagnostiky o něm spadnou do generovaného `.md`/`.json` reportu (`toFinding` → `toRelPosix`).

Dopad je omezený: v nástroji **není žádný exfiltrační kanál** (žádná síť), takže nejde o
přímý únik — je to (a) probing existence/struktury souborového systému vývojáře a (b)
vtažení obsahu/cest cizích souborů do reportu, který vývojář může následně sdílet.
Izolace forkem to **NEzmírňuje** — fork je obrana proti OOM/zaseknutí, ne FS sandbox; dítě
má plný FS přístup uživatele. Pozn.: ESLint vrstva tímto netrpí — lintuje jen soubory ze
`scanTree` (uvnitř kořene, `node_modules` přeskočen), kdežto `tsconfig` se parsuje nezávisle
na scanu. Směr opravy (mimo tento review): po `parseJsonConfigFileContent` odfiltrovat z
`cmd.fileNames` cesty, které po `path.resolve` neleží pod `root`, a odmítnout/ohlásit
`tsconfig`, jehož `files`/`extends` míří ven (kind `skipped` s pravdivým důvodem).

### SEC-2 · nit · Markdown injection do reportu přes název souboru (CR/LF v `loc` není ošetřen)
**Where:** `src/report/markdown.ts:148` (`renderFinding`)

`renderFinding` ošetřuje **zprávu** přes `sanitizeInline` (newline → mezera, backtick → `'`),
ale u **`loc`** volá jen `formatLocation(f).replace(/`/g, "'")` — backtick odstraní, **CR/LF ne**.
Název souboru na Linuxu smí obsahovat newline a git takový soubor unese; `loc` se z něj plní
(`f.file` ← `d.file.fileName` / `r.filePath`). Soubor pojmenovaný např. `evil\n## Injekce.ts`
pak rozbije inline code-span v odrážce a vloží do reportu řádek, který se renderuje mimo
zamýšlenou strukturu. Protože jde o **lokální `.md` bez spouštění** a v tomto rozsahu report
nikam neteče, je dopad nízký (kosmetické rozbití / matoucí nadpis), proto nit. Podstatná je
**nekonzistence**: autoři newline ve zprávě záměrně neutralizují, u cesty na to zapomněli.
Směr opravy: pustit `loc` stejnou inline-sanitizací jako zprávu (newline → mezera).

### SEC-3 · nit · Rozšíření závislostní plochy (eslint 9 + parser, typescript do `dependencies`)
**Where:** `package.json:27–33`, `package-lock.json` (+~1300 řádků)

Přibyly produkční závislosti `eslint ^9.39.4` a `@typescript-eslint/parser ^8.61.1` a
`typescript` se přesunul z dev do `dependencies` (`^5.9.3`). Jsou to mainstreamové balíky bez
neobvyklých install-time scriptů, ale táhnou rozsáhlý tranzitivní strom a **běží in-process
nad nedůvěryhodným kódem**. Riziko je zmírněno tím, co rozsah dělá dobře (přibalený TS místo
cizího, `overrideConfigFile: true`, parser/pravidla jako naše objekty, fork izolace). Čistě
informační poznámka pro supply-chain přehled; žádná akce nutná teď.

## Checked and clean
- **Spouštění procesů (`runIsolated.ts:73` `fork`)** — `childPath` se odvozuje z
  `import.meta.url` (vlastní modul nástroje), ne z cizího vstupu; `execArgv` je jen
  `--max-old-space-size=<číslo>` (clampnuté) a v dev navíc `--import tsx` — žádný cizí
  řetězec. `fork` nepoužívá shell, argumenty jdou jako argv pole. `payload` (`root`, `files`)
  jde přes IPC structured-clone jako **data**, ne jako argv/shell → žádná command/argument injection.
- **Non-goal č. 1 (cizí kód se NEspouští) — ESLint** — `overrideConfigFile: true` + `overrideConfig`
  je dokumentovaný způsob, jak ESLint 9 přinutit **nehledat ani nenačíst** projektový
  `eslint.config.js` (ověřeno proti docs ESLint). Parser i pravidla jsou naše importované
  objekty, ne názvy resolvované z cílových `node_modules`. `project` u tsParseru se nenastavuje
  → parser nestaví TS program ani nečte tsconfig. `fix:false`. ESLint jen parsuje na AST.
- **Non-goal č. 1 — tsc** — `loadTypescript.ts` importuje **přibalený** `typescript`, ne cizí
  z `node_modules` cíle (žádné `require` trojanizovaného modulu). `readProjectTypescriptVersion`
  čte `node_modules/typescript/package.json` přes `JSON.parse` (data), ne `require` (inertní).
  `createProgram` jen typuje, nevykonává; compiler options přebity na `noEmit`+vypnutý
  incremental/composite/tsBuildInfo → do cíle se **nezapisuje** (žádné `.tsbuildinfo`).
- **Zápis na FS** — v celém rozsahu žádný zápis do analyzovaného projektu; reporty jdou do
  `outDir` (mimo rozsah). ESLint targets = `path.join(root, f.path)` jen ze `scanTree` (uvnitř
  kořene). Jediné čtení mimo kořen řízené útočníkem je SEC-1 (tsc/tsconfig).
- **Parsování cizího vstupu** — `tsconfig` přes `parseConfigFileTextToJson` (JSONC), chyba →
  `skipped`, nehází. `readProjectTypescriptVersion` má `JSON.parse` v try/catch → `undefined`.
  IPC zpráva v `analyzeChild` přichází jen od rodiče (náš kód), gate `if (process.send)` brání
  běhu při pouhém importu. `looksLikeOom` regex nad stderr — stderr plní jen náš stack při pádu
  (tsc/ESLint nálezy jdou přes API, ne stdout/stderr), buffer je tak prakticky omezený.
- **Prompt injection / agent trust** — v tomto rozsahu **neaplikovatelné**: strojová vrstva
  neplní žádný Claude prompt s tool-accessem (AI vrstva přijde později). Jediný průtok cizího
  obsahu je do lokálního `.md`/`.json` reportu, kde strukturální breakery (newline, fence,
  backtick) ošetřuje `sanitizeInline`/`neutralizeFences`/blockquote — zbytkové mezery viz SEC-2.
