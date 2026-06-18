import { realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import * as path from "node:path";

export interface LoadedTypescript {
  ts: typeof import("typescript");
  /** "project" = verze z node_modules cíle; "bundled" = náš přibalený typescript */
  source: "project" | "bundled";
}

/**
 * Hybridní načtení TypeScriptu pro analýzu cizího projektu.
 *
 * 1) Nejdřív zkusí `typescript` z `node_modules` analyzovaného projektu – ať
 *    typujeme PŘESNĚ jeho verzí (jinak verze náš vs jejich = falešné nálezy).
 * 2) Když ho projekt nemá, spadne na přibalený (proto je `typescript` runtime
 *    dependency, ne jen dev).
 *
 * Schválně NIC neinstalujeme – čteme projekt tak, jak ho najdeme (non-goal č. 1).
 * Resolve omezíme na `node_modules` přímo pod kořenem: jinak by `createRequire`
 * vyšplhal k NAŠEMU typescriptu (když cíl leží uvnitř jiného projektu) a "project"
 * by lhal.
 */
export async function loadTypescript(root: string): Promise<LoadedTypescript> {
  try {
    // referenční bod pro resolve; soubor nemusí fyzicky existovat
    const req = createRequire(path.join(root, "package.json"));
    // req.resolve vrací REALPATH (Node rozbalí symlinky). Proto i hranici
    // porovnáváme přes realpath node_modules – jinak by u pnpm (kde je
    // node_modules/typescript symlink do node_modules/.pnpm/…) guard cestu
    // odmítl a verze projektu by se nikdy nepoužila.
    const tsPath = req.resolve("typescript");
    const ownPrefix = (await realNodeModules(root)) + path.sep;
    if (tsPath.startsWith(ownPrefix)) {
      const ts = req(tsPath) as typeof import("typescript");
      if (ts && typeof ts.createProgram === "function") {
        return { ts, source: "project" };
      }
    }
  } catch {
    // projekt typescript nemá / nejde načíst → fallback na přibalený
  }

  const mod = await import("typescript");
  // typescript je CommonJS: pod NodeNext je celý modul na `default`.
  const ts = ((mod as { default?: typeof import("typescript") }).default ??
    (mod as unknown as typeof import("typescript"))) as typeof import("typescript");
  return { ts, source: "bundled" };
}

/** realpath(root/node_modules); když neexistuje, vrátí nerozbalenou cestu (fallback). */
async function realNodeModules(root: string): Promise<string> {
  const nm = path.join(root, "node_modules");
  try {
    return await realpath(nm);
  } catch {
    return nm;
  }
}
