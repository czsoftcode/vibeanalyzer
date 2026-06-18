# Review findings

> Recorded by `mini findings add` (the adversarial and verify review steps).
> Each entry is `## <id> · <severity> · <status>`; do not hand-edit those header
> lines.

## 13-1 · should-know · resolved
**Where:** src/analyze/eslintConfig.ts:62-70
**Reviewed-at:** 1d6e52e8198e9e583340337fa54419e2111b4069
**Source:** project
**Range:** 12-13
ESLint hlásí na validním .jsx falešný 'Parsing error' jako error nález

JS flat-config blok (files=**/*.js,.jsx,.mjs,.cjs) běží na espree bez parserOptions.ecmaFeatures.jsx. Ověřeno empiricky: soubor comp.jsx s 'export const A = () => <div>hi</div>' vrátí finding {severity:error, message:'Parsing error: Unexpected token <', line:1}. .tsx je v pořádku (tsParser autodetekuje JSX dle přípony), ale .jsx a .js s JSX ne. Cílová skupina (vibekodeři, často React) tím dostane do reportu falešné 'error' nálezy na zdravém kódu → podkopává důvěru v nástroj. Žádný test JSX nepokrývá (eslint.test.ts ani markdown.eslint.test.ts). Fix: do JS bloku přidat ecmaFeatures:{jsx:true}.

## 13-2 · should-know · open
**Where:** src/analyze/loadTypescript.ts:36-41
**Reviewed-at:** 1d6e52e8198e9e583340337fa54419e2111b4069
**Source:** project
**Range:** 12-13
loadTypescript spouští TS z node_modules cíle (req) – napětí s non-goalem 'jen čte, nespouští'

Projekt deklaruje 'čte – nespouští' a non-goal č.1 'do not run or execute the analyzed code'. loadTypescript ale přes createRequire(target/package.json).resolve('typescript') a req(tsPath) NAČTE a vyhodnotí JS modul ležící uvnitř adresáře analyzovaného projektu (jeho node_modules/typescript). To je vykonání kódu z cíle, ne čtení. U běžného projektu neškodné, ale je to přímý rozpor s deklarovaným přístupem i non-goalem a otevírá to plochu (trojanizovaný node_modules/typescript/lib/typescript.js se spustí při require). Komentář v souboru tvrdí 'Schválně NIC neinstalujeme – čteme projekt tak, jak ho najdeme', což zastírá, že se cizí JS reálně spouští. Bezpečnostní dopad nechávám na samostatný mini security pass; tady jde o kontrakt vs. realita.

## 13-3 · should-know · resolved
**Where:** src/cli.ts:188-238; src/analyze/tsc.ts:84-92
**Reviewed-at:** 1d6e52e8198e9e583340337fa54419e2111b4069
**Source:** project
**Range:** 12-13
tsc i ESLint běží bez timeoutu/limitu nad CELÝM projektem – velký projekt může spadnout (OOM), ne jen viset

Komentáře přiznávají 'bez timeoutu, u obřího monorepa to může chvíli viset (vědomě přijaté riziko V1)'. Jenže přijaté riziko je VISENÍ; createProgram+getPreEmitDiagnostics a eslint.lintFiles nad tisíci souborů ale můžou spotřebovat paměť a proces SPADNE (OOM), což porušuje success criterion 'Spuštění na složce vyrobí report bez pádu'. Navíc projekt sám pro AI vrstvu projekt KRÁJÍ kvůli limitům, ale strojová vrstva žádné krájení/strop nemá – nekonzistence v rámci stejného nástroje. try/catch v cli.ts chytí jen synchronní/async throw, ne OOM ani zamrznutí. Reálný vstup: jeden velký vibe-projekt s node_modules zahrnutými do tsconfigu. Minimálně bych čekal strop na počet souborů s degradací na 'skipped: příliš velký projekt', ne tichý OOM.
