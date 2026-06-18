export interface LoadedTypescript {
  ts: typeof import("typescript");
  /** verze POUŽITÉHO (přibaleného) TypeScriptu, např. "5.9.3" – do reportu */
  version: string;
}

/**
 * Načte PŘIBALENÝ TypeScript pro analýzu cizího projektu.
 *
 * Záměrně NEpoužíváme `typescript` z `node_modules` analyzovaného projektu:
 * jeho `require`/načtení = VYHODNOCENÍ cizího JS, což je spuštění kódu z cíle, ne
 * čtení – přímý rozpor s non-goalem č. 1 „do not run or execute the analyzed code"
 * (a plocha pro trojanizovaný node_modules/typescript). Typujeme tedy vždy naší
 * přibalenou verzí; případný rozdíl proti verzi projektu report přizná (viz tsc.ts),
 * ať se nálezy posuzují s vědomím možného verzního rozdílu.
 */
export async function loadTypescript(): Promise<LoadedTypescript> {
  // typescript je CommonJS: pod NodeNext je celý modul na `default`.
  const mod = await import("typescript");
  const ts = ((mod as { default?: typeof import("typescript") }).default ??
    (mod as unknown as typeof import("typescript"))) as typeof import("typescript");
  return { ts, version: ts.version };
}
