/**
 * Detekce minifikátů podle JMÉNA souboru (`app.min.js`, `style.min.css`).
 *
 * JEDINÝ zdroj pravdy pro tohle rozhodnutí – sdílí ho skener tajemství
 * (`secrets.ts`) i ESLint analyzátor (`analyze/eslint.ts`). Holý regex na dvou
 * místech by se při úpravě rozešel; konstanta + sdílená funkce drží kontrakt.
 *
 * Záměrně leží v `src/` bez závislostí (žádný import ESLintu/parseru), ať si ho
 * může natáhnout kdokoli bez tahání těžkých knihoven.
 *
 * V1 OMEZENÍ (vědomé): rozhoduje se POUZE podle přípony `.min.<ext>`. Bundly bez
 * téhle konvence (`bundle.js`, `vendor.js`, webpackem zřetězené, ale ne `.min`)
 * filtrem PROJDOU a budou se dál lintovat/skenovat. Obsahová detekce (extrémně
 * dlouhý řádek) zůstává jako samostatná záloha tam, kde se obsah stejně čte
 * (`secrets.ts`), ne tady – tento modul vstup nečte.
 */

/** `something.min.js`, `app.min.css`, … – tečka, `min`, tečka, neprázdná přípona. */
const MINIFIED_NAME_RE = /\.min\.[a-z0-9]+$/i;

/**
 * `true`, když jméno souboru vypadá jako minifikát (`*.min.<přípona>`).
 *
 * Bere JMÉNO souboru, ne celou cestu – volající si basename vytáhne sám
 * (cesta `a/b/c.min.js` projde taky, regex je ukotvený na konec, ale počítej s
 * tím, že segment před `.min` může být i prázdný u patologického `.min.js`).
 */
export function isMinifiedName(name: string): boolean {
  return MINIFIED_NAME_RE.test(name);
}
