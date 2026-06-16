import * as path from "node:path";
import type { Intent } from "../intent.js";
import type { FileEntry } from "../scan.js";

export interface MarkdownInput {
  root: string;
  generatedAt: string;
  files: FileEntry[];
  skippedUnreadable: string[];
  /** Záměr z project.md analyzovaného projektu; null/undefined = nedodán. */
  intent?: Intent | null;
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

/**
 * Zneškodní trojitý (a delší) plot z backticků v cizím textu. project.md píše
 * uživatel/jiný nástroj; kdyby v záměru byl ```` ```mermaid ````, otevřel by
 * uvnitř našeho reportu nový code fence a spolkl by zbytek (i náš diagram).
 * Trojitý backtick zkrátíme na jeden – inline kód zůstane, fence se nespustí.
 */
function neutralizeFences(line: string): string {
  return line.replace(/`{3,}/g, "`");
}

/**
 * Vloží cizí text jako blockquote (každý řádek `> `). Spolu s neutralizeFences
 * tím udržíme cizí `#` nadpisy i fence uvnitř citace – nerozbijí strukturu
 * našich sekcí ani Mermaid blok.
 */
function blockquote(text: string): string[] {
  return text.split("\n").map((line) => `> ${neutralizeFences(line)}`);
}

/**
 * Sekce "## Záměr projektu" do hlavičky reportu. Když záměr (nebo jeho část)
 * chybí, vypíše explicitní "_nedodáno_" – záměrně viditelný stav, ne prázdná
 * díra. Hodnocení nálezů vůči záměru sem nepatří (to až AI vrstva).
 */
function intentSection(intent: Intent | null | undefined): string[] {
  const out: string[] = ["## Záměr projektu", ""];

  if (!intent) {
    out.push(
      "_Záměr nedodán._ Nenašel jsem v analyzovaném projektu `.mini/project.md` ani `project.md`.",
    );
    out.push("");
    return out;
  }

  // sourcePath je odvozen z cesty cíle (uživatel ji řídí) → taky cizí vstup.
  // Backtick i newline v názvu složky by rozbily inline code span hlavičky
  // (backtick ukončí span, newline ho přeruší); oba nahradíme (nálezy 4-5).
  const safeSource = intent.sourcePath.replace(/`/g, "'").replace(/[\r\n]/g, " ");
  out.push(`Načteno z \`${safeSource}\`.`);
  out.push("");

  out.push("**Co se staví:**");
  out.push("");
  if (intent.building === null) {
    out.push("> _nedodáno_");
  } else {
    out.push(...blockquote(intent.building));
  }
  out.push("");

  out.push("**Deklarované non-goaly:**");
  out.push("");
  if (intent.nonGoals === null) {
    out.push("> _nedodáno_");
  } else {
    for (const ng of intent.nonGoals) out.push(`> - ${neutralizeFences(ng)}`);
  }
  out.push("");

  return out;
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

  out.push(...intentSection(input.intent));

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
