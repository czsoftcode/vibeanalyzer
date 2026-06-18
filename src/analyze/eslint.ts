import { ESLint } from "eslint";
import * as path from "node:path";
import type { EslintResult, Finding, Severity } from "../findings.js";
import type { FileEntry } from "../scan.js";
import { eslintConfig, LINTABLE_EXTENSIONS } from "./eslintConfig.js";

export interface EslintAnalyzeDeps {
  /**
   * Zavolá se PŘED (potenciálně dlouhým) během ESLint, s počtem souborů – aby CLI
   * mohlo vypsat "spouštím ESLint nad N soubory". Bez tvrdého timeoutu (jako tsc).
   */
  onStart?: (fileCount: number) => void;
  /** injektovatelná továrna na ESLint instanci (test) */
  createEslint?: (root: string) => ESLint;
}

/**
 * Lint analýza projektu naším pevným configem. ESLint jen PARSUJE zdrojáky na AST
 * a pravidla nad nimi čtou – kód projektu se NEvykoná. `overrideConfigFile: true`
 * zajistí, že se projektový `eslint.config.js` vůbec nehledá ani nespustí
 * (bezpečnost + non-goal č. 1). Nikdy neopravuje (`fix: false`).
 *
 * Vrací diskriminovaný výsledek; "ran s 0 nálezy" (čistý) ≠ "skipped" (neproběhlo).
 */
export async function analyzeESLint(
  root: string,
  files: readonly FileEntry[],
  deps: EslintAnalyzeDeps = {},
): Promise<EslintResult> {
  const targets = files
    .filter((f) => f.type === "file" && LINTABLE_EXTENSIONS.has(f.ext))
    .map((f) => path.join(root, f.path));

  if (targets.length === 0) {
    return { kind: "skipped", reason: "v projektu nejsou žádné JS/TS soubory k lintování" };
  }

  deps.onStart?.(targets.length);

  const eslint = deps.createEslint?.(root) ?? defaultEslint(root);
  const results = await eslint.lintFiles(targets);

  const findings: Finding[] = [];
  for (const r of results) {
    for (const m of r.messages) {
      findings.push(toFinding(root, r.filePath, m));
    }
  }

  return { kind: "ran", findings, fileCount: results.length };
}

function defaultEslint(root: string): ESLint {
  return new ESLint({
    cwd: root,
    overrideConfigFile: true, // projektový eslint.config.js se NEHLEDÁ ani nenačte
    overrideConfig: eslintConfig as ESLint.Options["overrideConfig"],
    fix: false, // nikdy neopravujeme (non-goal "do not auto-fix")
    errorOnUnmatchedPattern: false, // zmizelý/nematchnutý soubor (TOCTOU) jen přeskočíme
  });
}

/** ESLint LintMessage → Finding. Parse-error (ruleId null, fatal) zůstane bez `rule`. */
function toFinding(root: string, absFile: string, m: ESLint.LintResult["messages"][number]): Finding {
  return {
    source: "eslint",
    severity: severityOf(m.severity),
    file: toRelPosix(root, absFile),
    line: m.line,
    column: m.column,
    rule: m.ruleId ?? undefined,
    message: m.message,
  };
}

/** ESLint: 2 = error, 1 = warning. (0 = off se v messages nevyskytne.) */
function severityOf(s: 0 | 1 | 2): Severity {
  return s === 2 ? "error" : "warning";
}

/** Cesta relativní ke kořeni s oddělovačem "/" (jako zbytek reportu). */
function toRelPosix(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join("/");
}
