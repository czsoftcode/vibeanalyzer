import * as os from "node:os";
import process from "node:process";

/**
 * Limity pro izolovaný běh strojové vrstvy (tsc/ESLint) v podprocesu.
 *
 * Proč: tsc i ESLint běží nad CELÝM projektem; u obřího vstupu (např. node_modules
 * vtažené do tsconfigu) můžou sežrat paměť a proces SPADNE (OOM), nebo se zaseknou.
 * Žádný try/catch OOM ani zamrznutí nechytí. Proto je pustíme v odděleném procesu
 * s limitem paměti (`--max-old-space-size`) a časovým limitem; když dítě překročí,
 * spadne/zabije se JEN ono a rodič to čistě ohlásí jako přeskočenou vrstvu.
 */

/** Kolik z DOSTUPNÉ paměti smí izolovaný proces použít (heap strop). */
export const MEMORY_PERCENT = 0.7;

/**
 * Spodní podlaha paměťového limitu. Bez ní by na vytíženém stroji (málo dostupné
 * paměti) vyšel strop tak nízko, že by spadl i malý zdravý projekt → přeskočili
 * bychom analýzu i tam, kde by v klidu proběhla.
 */
export const MEMORY_FLOOR_MB = 1024;

/**
 * Horní strop. `--max-old-space-size` je strop, ne cíl – kdybychom dovolili dítěti
 * růst na desítky GB (75 % velkého stroje), udusilo by mezitím hostitele, než ho
 * V8 sekne. Tsc reálně tolik nepotřebuje; nad tímhle už je to spíš zacyklení.
 */
export const MEMORY_CEILING_MB = 8192;

/** Časový limit izolovaného běhu. Po něm rodič dítě zabije → „trvalo příliš dlouho". */
export const ANALYSIS_TIMEOUT_MS = 120_000;

/**
 * Bajty dostupné paměti. `process.availableMemory()` (Node 22+) respektuje cgroup
 * limity (kontejnery) a hlásí REÁLNĚ dostupnou paměť. Fallback `os.freemem()` pro
 * starší Node (engines dovoluje >=20); pozor, ten na Linuxu hlásí míň (necítí
 * uvolnitelnou cache), takže limit pak vyjde konzervativněji – přijatelné.
 */
export function availableMemoryBytes(): number {
  const avail = (process as { availableMemory?: () => number }).availableMemory;
  if (typeof avail === "function") return avail.call(process);
  return os.freemem();
}

/**
 * Spočítá hodnotu pro `--max-old-space-size` (v MB) z dostupné paměti.
 * Čistá funkce (vstup = bajty) → deterministicky testovatelná bez závislosti na
 * reálné paměti stroje. Výsledek je vždy v [MEMORY_FLOOR_MB, MEMORY_CEILING_MB].
 */
export function computeMemoryLimitMb(availableBytes: number): number {
  const raw = Math.floor((availableBytes / (1024 * 1024)) * MEMORY_PERCENT);
  if (raw < MEMORY_FLOOR_MB) return MEMORY_FLOOR_MB;
  if (raw > MEMORY_CEILING_MB) return MEMORY_CEILING_MB;
  return raw;
}
