import { describe, expect, it } from "vitest";
import type { FileEntry } from "../scan.js";
import { buildFolderDiagram, buildMarkdown } from "./markdown.js";

const SAMPLE: FileEntry[] = [
  { path: "src", type: "dir", ext: "", size: 0, depth: 1 },
  { path: "src/index.ts", type: "file", ext: ".ts", size: 20, depth: 2 },
  { path: "README.md", type: "file", ext: ".md", size: 10, depth: 1 },
];

describe("buildMarkdown", () => {
  it("obsahuje mermaid blok i seznam souborů", () => {
    const md = buildMarkdown({
      root: "/home/user/proj",
      generatedAt: "2026-06-15T18:00:00.000Z",
      files: SAMPLE,
      skippedUnreadable: [],
    });
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph TD");
    expect(md).toContain("`src/index.ts`");
    expect(md).toContain("Souborů: 2");
    expect(md).toContain("Složek: 1");
  });

  it("nečitelné soubory dostanou vlastní sekci", () => {
    const md = buildMarkdown({
      root: "/p",
      generatedAt: "t",
      files: SAMPLE,
      skippedUnreadable: ["locked"],
    });
    expect(md).toContain("## Nečitelné (přeskočeno)");
    expect(md).toContain("`locked`");
  });
});

describe("buildMarkdown – sekce Záměr projektu", () => {
  const base = {
    root: "/p",
    generatedAt: "t",
    files: SAMPLE,
    skippedUnreadable: [] as string[],
  };

  it("bez záměru ukáže explicitní 'nedodáno', ne prázdnou díru", () => {
    const md = buildMarkdown(base);
    expect(md).toContain("## Záměr projektu");
    expect(md).toContain("_Záměr nedodán._");
  });

  it("se záměrem vykreslí text, non-goaly i zdroj", () => {
    const md = buildMarkdown({
      ...base,
      intent: {
        building: "Lokální CLI nástroj.",
        nonGoals: ["Nespouští kód.", "Bez webové služby."],
        sourcePath: "/p/.mini/project.md",
      },
    });
    expect(md).toContain("Načteno z `/p/.mini/project.md`.");
    expect(md).toContain("> Lokální CLI nástroj.");
    expect(md).toContain("> - Nespouští kód.");
    expect(md).toContain("> - Bez webové služby.");
  });

  it("chybějící část záměru → '_nedodáno_' (ne tichý prázdný blok)", () => {
    const md = buildMarkdown({
      ...base,
      intent: { building: null, nonGoals: null, sourcePath: "/p/project.md" },
    });
    expect(md).toContain("> _nedodáno_");
  });

  it("injection: backtick v sourcePath nerozbije inline code span", () => {
    const md = buildMarkdown({
      ...base,
      intent: { building: "x", nonGoals: null, sourcePath: "/p/`zlo`/project.md" },
    });
    // backtick z cesty je pryč (nahrazen), takže code span zůstane uzavřený
    expect(md).toContain("Načteno z `/p/'zlo'/project.md`.");
    expect(md).not.toContain("`zlo`");
  });

  it("injection: newline v sourcePath nepřeruší inline code span (4-5)", () => {
    const md = buildMarkdown({
      ...base,
      intent: { building: "x", nonGoals: null, sourcePath: "/p/zlo\nnewline/project.md" },
    });
    expect(md).toContain("Načteno z `/p/zlo newline/project.md`.");
    // řádek 'Načteno z ...' zůstane na jednom řádku (newline nahrazen mezerou)
    const nactenoLines = md.split("\n").filter((l) => l.includes("Načteno z"));
    expect(nactenoLines).toHaveLength(1);
  });

  it("injection: cizí code fence v záměru nerozbije náš report", () => {
    const md = buildMarkdown({
      ...base,
      intent: {
        building: "Zlo\n```mermaid\ngraph TD; HACK\n```\n## Falešný nadpis",
        nonGoals: ["```bash\nrm -rf /\n```"],
        sourcePath: "/p/project.md",
      },
    });
    // jediný code fence v reportu je náš mermaid blok → přesně 2 výskyty ``` (open+close)
    expect((md.match(/```/g) ?? []).length).toBe(2);
    // náš diagram zůstal celý
    expect(md).toContain("```mermaid");
    expect(md).toContain("graph TD");
    // cizí nadpis je zacitovaný (blockquote), ne reálná sekce reportu
    expect(md).toContain("> ## Falešný nadpis");
    expect(md).not.toMatch(/^## Falešný nadpis$/m);
  });
});

describe("buildFolderDiagram", () => {
  it("napojí podsložky na rodiče", () => {
    const d = buildFolderDiagram(["src", "src/util"], "proj", 60);
    expect(d.truncated).toBe(false);
    const text = d.lines.join("\n");
    expect(text).toContain("graph TD");
    // dvě hrany: kořen->src, src->src/util
    expect(text.match(/-->/g)?.length).toBe(2);
  });

  it("ořízne při překročení limitu uzlů", () => {
    const dirs = Array.from({ length: 10 }, (_, i) => `d${i}`);
    const d = buildFolderDiagram(dirs, "proj", 5);
    expect(d.truncated).toBe(true);
    expect(d.shown).toBe(4); // limit 5 minus kořen
    expect(d.total).toBe(10);
  });
});
