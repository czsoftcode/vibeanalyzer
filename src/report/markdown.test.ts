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
