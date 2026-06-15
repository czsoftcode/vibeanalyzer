import * as path from "node:path";
import type { FileEntry } from "../scan.js";

export interface MarkdownInput {
  root: string;
  generatedAt: string;
  files: FileEntry[];
  skippedUnreadable: string[];
}

export interface MarkdownOptions {
  /** maximální počet uzlů (složek včetně kořene) v diagramu; zbytek se ořízne */
  maxDiagramNodes?: number;
}

const DEFAULT_MAX_DIAGRAM_NODES = 60;

/** Nahradí znaky, které by rozbily Mermaid label v hranatých závorkách. */
function escapeLabel(s: string): string {
  return s.replace(/"/g, "'").replace(/[[\]]/g, "");
}

export interface FolderDiagram {
  lines: string[];
  total: number;
  shown: number;
  truncated: boolean;
}

/**
 * Postaví Mermaid diagram (graph TD) JEN nad složkami.
 * Při překročení limitu uzlů se diagram ořízne (a volající to napíše do reportu).
 */
export function buildFolderDiagram(
  dirPaths: readonly string[],
  rootLabel: string,
  maxNodes: number,
): FolderDiagram {
  const total = dirPaths.length;
  const sorted = [...dirPaths].sort();
  // jeden uzel rezervujeme pro kořen
  const shownPaths = sorted.slice(0, Math.max(0, maxNodes - 1));
  const truncated = shownPaths.length < total;

  const idOf = new Map<string, number>();
  idOf.set("", 0);
  let next = 1;
  for (const p of shownPaths) idOf.set(p, next++);

  const labelFor = (p: string): string => (p === "" ? rootLabel : (p.split("/").pop() ?? p));

  const lines: string[] = ["graph TD"];
  lines.push(`  n0["${escapeLabel(rootLabel)}"]`);
  for (const p of shownPaths) {
    lines.push(`  n${idOf.get(p)}["${escapeLabel(labelFor(p))}"]`);
  }
  for (const p of shownPaths) {
    const slash = p.lastIndexOf("/");
    const parent = slash === -1 ? "" : p.slice(0, slash);
    // rodič mohl vypadnout kvůli ořezu → napojíme na kořen
    const parentId = idOf.has(parent) ? idOf.get(parent) : 0;
    lines.push(`  n${parentId} --> n${idOf.get(p)}`);
  }

  return { lines, total, shown: shownPaths.length, truncated };
}

/** Sestaví lidský `.md` report ze stejného modelu, jaký jde do JSON. */
export function buildMarkdown(input: MarkdownInput, options: MarkdownOptions = {}): string {
  const maxNodes = options.maxDiagramNodes ?? DEFAULT_MAX_DIAGRAM_NODES;
  const fileEntries = input.files.filter((f) => f.type === "file");
  const dirPaths = input.files.filter((f) => f.type === "dir").map((f) => f.path);
  const rootLabel = path.basename(input.root) || input.root;

  const diagram = buildFolderDiagram(dirPaths, rootLabel, maxNodes);

  const out: string[] = [];
  out.push("# VibeAnalyzer – strukturální report");
  out.push("");
  out.push(`- Kořen: \`${input.root}\``);
  out.push(`- Vygenerováno: ${input.generatedAt}`);
  out.push(`- Souborů: ${fileEntries.length}`);
  out.push(`- Složek: ${dirPaths.length}`);
  if (input.skippedUnreadable.length > 0) {
    out.push(`- Přeskočeno (nečitelné): ${input.skippedUnreadable.length}`);
  }
  out.push("");

  out.push("## Struktura složek");
  out.push("");
  out.push("Diagram ukazuje jen složky (ne jednotlivé soubory) a vykreslí se jen v prohlížeči s podporou Mermaid (např. GitHub nebo VS Code).");
  if (diagram.truncated) {
    out.push("");
    out.push(`> Diagram byl oříznut: zobrazeno ${diagram.shown} z ${diagram.total} složek (limit ${maxNodes} uzlů). Úplný seznam je v JSON indexu.`);
  }
  out.push("");
  out.push("```mermaid");
  out.push(...diagram.lines);
  out.push("```");
  out.push("");

  out.push("## Soubory");
  out.push("");
  if (fileEntries.length === 0) {
    out.push("_Žádné soubory._");
  } else {
    for (const f of fileEntries) {
      out.push(`- \`${f.path}\` (${f.size} B)`);
    }
  }
  out.push("");

  if (input.skippedUnreadable.length > 0) {
    out.push("## Nečitelné (přeskočeno)");
    out.push("");
    for (const p of input.skippedUnreadable) {
      out.push(`- \`${p}\``);
    }
    out.push("");
  }

  return out.join("\n");
}
