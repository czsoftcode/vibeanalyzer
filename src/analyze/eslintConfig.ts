import tsParser from "@typescript-eslint/parser";
import type { Linter } from "eslint";
import { JS_EXTENSIONS, TS_EXTENSIONS } from "./sourceExtensions.js";

/**
 * Náš pevný ESLint config (flat). Záměrně NEnačítáme projektový `eslint.config.js`
 * (spustitelný JS = bezpečnostní riziko, viz discuss). Tohle je jediný config,
 * který běží – nálezy jsou "dle vibeanalyzeru", ne dle pravidel projektu.
 *
 * Ruleset je úzký: JEN pravidla na pravděpodobné bugy, žádný styl (formátování
 * řeší prettier, ne my; styl by jen tříštil report šumem). Vše jsou jádrová
 * pravidla, fungují i nad TS AST – nepotřebují typovou informaci (žádný TS projekt
 * se nestaví, na rozdíl od tsc vrstvy).
 */
const CORRECTNESS_RULES: Linter.RulesRecord = {
  eqeqeq: ["error", "always"],
  "no-empty": ["error", { allowEmptyCatch: false }], // spolknutá chyba (prázdný catch)
  "no-debugger": "error", // zapomenutý debugger
  "no-cond-assign": ["error", "always"], // omylem `=` místo `===` v podmínce
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-unreachable": "error", // kód za return/throw
  "no-fallthrough": "error", // switch bez break
  "no-constant-condition": "error", // `if (true)`, `while (1)`
  "no-self-compare": "error", // `x === x`
};

// JEDINÝ zdroj pravdy pro přípony žije v sourceExtensions.ts (sdílí ho i graf
// importů). Glob v configu i množina, kterou analyzátor posílá do lintu
// (LINTABLE_EXTENSIONS), se odvozují odsud – nesmí se rozejít: kdyby analyzátor
// poslal soubor, na který config nemá glob, ESLint vrátí fatal "File ignored
// because no matching configuration" jako falešný "error" nález.

/** Přípony, které tahle konfigurace umí zpracovat. Importuje analyzátor pro filtr. */
export const LINTABLE_EXTENSIONS: ReadonlySet<string> = new Set([...JS_EXTENSIONS, ...TS_EXTENSIONS]);

const toGlobs = (exts: readonly string[]): string[] => exts.map((e) => `**/*${e}`);
const JS_FILES = toGlobs(JS_EXTENSIONS);
const TS_FILES = toGlobs(TS_EXTENSIONS);

// Cizí projekt může mít `// eslint-disable …` pro SVÁ pravidla; vůči našemu
// rulesetu jsou ty direktivy „nepoužité" a ESLint by je hlásil jako warning –
// falešný šum o cizím kódu. Vypneme reportování nepoužitých disable direktiv.
const LINTER_OPTIONS = { reportUnusedDisableDirectives: "off" } as const;

/**
 * Flat-config pole pro ESLint. Předává se jako `overrideConfig` s
 * `overrideConfigFile: true` (= projektový config se vůbec nehledá).
 * Parser i pravidla jsou NAŠE objekty, ne názvy resolvované z node_modules cíle.
 */
export const eslintConfig: Linter.Config[] = [
  {
    files: JS_FILES,
    // ecmaFeatures.jsx: espree (default JS parser) bez něj hlásí na validním .jsx
    // i .js s JSX falešný fatal "Parsing error: Unexpected token <" jako error
    // nález. Cílová skupina (vibekodeři, často React) by dostala šum na zdravém
    // kódu. TS blok to nepotřebuje – tsParser autodetekuje JSX dle přípony (.tsx).
    languageOptions: { ecmaVersion: "latest", sourceType: "module", parserOptions: { ecmaFeatures: { jsx: true } } },
    linterOptions: LINTER_OPTIONS,
    rules: {
      ...CORRECTNESS_RULES,
      // VYPNUTO i na JS: od zapnutí ecmaFeatures.jsx (výš) se JS soubory s JSX
      // naparsují, jenže jádrové no-unused-vars NErozumí JSX použití → na zdravém
      // React kódu hlásí falešné "'Button'/'React' is defined but never used"
      // (importy komponent, JSX pragma). JSX-aware variantu (react/jsx-uses-vars)
      // bez eslint-plugin-react nemáme. Cílovka jsou React vibekodeři → radši
      // žádný nález než falešný (stejně jako TS blok níž). Bug-rules (eqeqeq,
      // no-cond-assign, …) běží dál; ztrácíme jen hygienický signál mrtvého kódu.
      "no-unused-vars": "off",
    },
  },
  {
    files: TS_FILES,
    languageOptions: { parser: tsParser as Linter.Parser, ecmaVersion: "latest", sourceType: "module" },
    linterOptions: LINTER_OPTIONS,
    rules: {
      ...CORRECTNESS_RULES,
      // VYPNUTO na TS: jádrové no-unused-vars hlásí false-positives na type-only
      // použití (typy, importy typů) a přesnou variantu (@typescript-eslint) bez
      // typového pluginu nemáme. Radši žádný nález než falešný.
      "no-unused-vars": "off",
    },
  },
];
