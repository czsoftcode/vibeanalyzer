#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import * as path from "node:path";
import process from "node:process";
import { defaultOutDir, parseArgs, validateTarget } from "./args.js";
import { buildJsonIndex } from "./report/jsonIndex.js";
import { buildMarkdown } from "./report/markdown.js";
import { scanTree } from "./scan.js";
import { fileTimestamp } from "./timestamp.js";
import { readPackageVersion } from "./version.js";

const HELP = `VibeAnalyzer – strukturální index projektu

Použití:
  vibeanalyzer [cesta] [--out <adresář>]

Argumenty:
  cesta            Složka k projití (výchozí: aktuální složka).

Volby:
  -o, --out <dir>  Kam uložit výstupy (výchozí: ~/.vibeanalyzer/<jméno projektu>).
  -h, --help       Zobrazí tuto nápovědu.
  -v, --version    Zobrazí verzi.

Výstup:
  vibeanalyzer-<timestamp>.json  strojový strukturální index
  vibeanalyzer-<timestamp>.md    lidský report se seznamem souborů a Mermaid diagramem`;

async function run(): Promise<number> {
  const parsed = parseArgs(process.argv.slice(2), process.cwd());

  if (parsed.kind === "help") {
    console.log(HELP);
    return 0;
  }
  if (parsed.kind === "version") {
    console.log(await readPackageVersion());
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(`Chyba: ${parsed.message}\n`);
    console.error(HELP);
    return 2;
  }

  const { targetPath } = parsed;
  const outDir = parsed.outDir ?? defaultOutDir(homedir(), targetPath);

  const valid = await validateTarget(targetPath);
  if (!valid.ok) {
    console.error(`Chyba: ${valid.message}`);
    return 1;
  }

  try {
    await mkdir(outDir, { recursive: true });
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    console.error(`Chyba: výstupní adresář nelze vytvořit: ${outDir} (${e.code ?? "neznámá chyba"})`);
    return 1;
  }

  const now = new Date();
  const generatedAt = now.toISOString();
  const stamp = fileTimestamp(now);

  const result = await scanTree(targetPath);

  const index = buildJsonIndex(targetPath, generatedAt, result.files);
  const md = buildMarkdown({
    root: targetPath,
    generatedAt,
    files: result.files,
    skippedUnreadable: result.skippedUnreadable,
  });

  const jsonPath = path.join(outDir, `vibeanalyzer-${stamp}.json`);
  const mdPath = path.join(outDir, `vibeanalyzer-${stamp}.md`);

  try {
    await writeFile(jsonPath, JSON.stringify(index, null, 2) + "\n", "utf8");
    await writeFile(mdPath, md + "\n", "utf8");
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    console.error(`Chyba: výstup nelze zapsat (${e.code ?? "neznámá chyba"}): ${e.message ?? ""}`);
    return 1;
  }

  const fileCount = result.files.filter((f) => f.type === "file").length;
  const dirCount = result.files.filter((f) => f.type === "dir").length;

  console.log(`VibeAnalyzer: prošel jsem ${fileCount} souborů a ${dirCount} složek v ${targetPath}`);
  if (result.skippedUnreadable.length > 0) {
    console.log(`Přeskočeno (nečitelné): ${result.skippedUnreadable.length}`);
  }
  console.log(`JSON index: ${jsonPath}`);
  console.log(`MD report:  ${mdPath}`);
  return 0;
}

run()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    console.error("Neočekávaná chyba:", err);
    process.exitCode = 1;
  });
