import { readFile } from "node:fs/promises";

/**
 * Přečte verzi z package.json vedle zkompilovaného balíčku.
 * Když se to nepovede (chybí soubor, poškozený JSON), vrátí "0.0.0"
 * místo pádu – verze není kritická pro běh.
 */
export async function readPackageVersion(): Promise<string> {
  try {
    const url = new URL("../package.json", import.meta.url);
    const raw = await readFile(url, "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
