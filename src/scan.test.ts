import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scanTree } from "./scan.js";

describe("scanTree", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "vibe-scan-"));
    // běžný projekt
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
    await writeFile(path.join(root, "README.md"), "# projekt\n", "utf8");
    // pomocné složky, které se mají přeskočit
    await mkdir(path.join(root, "node_modules", "leftpad"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "leftpad", "index.js"), "// dep\n", "utf8");
    await mkdir(path.join(root, ".git"), { recursive: true });
    await writeFile(path.join(root, ".git", "HEAD"), "ref\n", "utf8");
    await mkdir(path.join(root, "dist"), { recursive: true });
    await writeFile(path.join(root, "dist", "index.js"), "// build\n", "utf8");
    // vlastní výstup nástroje
    await writeFile(path.join(root, "vibeanalyzer-2026-06-15T00-00-00-000Z.json"), "{}\n", "utf8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  it("zahrne vlastní soubory a vynechá pomocné složky a vlastní výstup", async () => {
    const { files } = await scanTree(root);
    const paths = files.map((f) => f.path).sort();

    expect(paths).toContain("src");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("README.md");

    expect(paths.some((p) => p.startsWith("node_modules"))).toBe(false);
    expect(paths.some((p) => p.startsWith(".git"))).toBe(false);
    expect(paths.some((p) => p.startsWith("dist"))).toBe(false);
    expect(paths.some((p) => p.startsWith("vibeanalyzer-"))).toBe(false);
  });

  it("vyplní metadata (typ, přípona, velikost, hloubka)", async () => {
    const { files } = await scanTree(root);
    const idx = files.find((f) => f.path === "src/index.ts");
    expect(idx).toBeDefined();
    expect(idx?.type).toBe("file");
    expect(idx?.ext).toBe(".ts");
    expect(idx?.depth).toBe(2);
    expect((idx?.size ?? 0)).toBeGreaterThan(0);

    const srcDir = files.find((f) => f.path === "src");
    expect(srcDir?.type).toBe("dir");
    expect(srcDir?.depth).toBe(1);
  });

  it("nesleduje symlinky (žádné zacyklení)", async () => {
    // symlink mířící na sebe/rodiče by při sledování zacyklil
    await symlink(root, path.join(root, "loop")).catch(() => {});
    const { files } = await scanTree(root);
    expect(files.some((f) => f.path === "loop")).toBe(false);
  });

  it("nečitelnou složku přeskočí a zaznamená, nespadne", async () => {
    const locked = path.join(root, "locked");
    await mkdir(locked, { recursive: true });
    await writeFile(path.join(locked, "secret.txt"), "x\n", "utf8");
    await chmod(locked, 0o000);

    const { skippedUnreadable } = await scanTree(root);
    // úklid práv, ať jde tempdir smazat
    await chmod(locked, 0o755).catch(() => {});

    expect(skippedUnreadable).toContain("locked");
  });
});
