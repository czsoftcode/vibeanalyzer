import { beforeAll, describe, expect, it } from "vitest";
import { extractRelativeSpecifiers } from "./imports.js";
import { loadTypescript } from "./loadTypescript.js";

let ts: typeof import("typescript");
beforeAll(async () => {
  ts = (await loadTypescript()).ts;
});

describe("extractRelativeSpecifiers", () => {
  it("vytáhne statický default/named/namespace/side-effect import a export…from", () => {
    const src = `
      import a from "./a.js";
      import { b } from "./b.js";
      import * as c from "../c.js";
      import "./side-effect.js";
      import type { T } from "./types.js";
      export { x } from "./x.js";
      export * from "./y.js";
    `;
    const got = extractRelativeSpecifiers(ts, src, ".ts");
    expect(got.sort()).toEqual(
      ["./a.js", "./b.js", "../c.js", "./side-effect.js", "./types.js", "./x.js", "./y.js"].sort(),
    );
  });

  it("víceřádkový import projde (specifier na jiném řádku než 'from')", () => {
    const src = `import {\n  one,\n  two,\n} from "./multi.js";\n`;
    expect(extractRelativeSpecifiers(ts, src, ".ts")).toEqual(["./multi.js"]);
  });

  it("import v komentáři ani v řetězci NEdá falešný nález", () => {
    const src = `
      // import x from "./fake-comment.js";
      /* import y from "./fake-block.js"; */
      const s = 'import z from "./fake-string.js"';
      const t = \`import w from "./fake-template.js"\`;
      import real from "./real.js";
    `;
    expect(extractRelativeSpecifiers(ts, src, ".ts")).toEqual(["./real.js"]);
  });

  it("dynamický import() a require() se NEberou (v1)", () => {
    const src = `
      const a = await import("./dyn.js");
      const b = require("./req.js");
      import real from "./real.js";
    `;
    expect(extractRelativeSpecifiers(ts, src, ".ts")).toEqual(["./real.js"]);
  });

  it("bare/balíkové a node: specifiery se zahodí (jen relativní)", () => {
    const src = `
      import react from "react";
      import { readFile } from "node:fs/promises";
      import x from "@scope/pkg";
      import rel from "./rel.js";
    `;
    expect(extractRelativeSpecifiers(ts, src, ".ts")).toEqual(["./rel.js"]);
  });

  it("dvojí import téhož specifieru se deduplikuje", () => {
    const src = `import { a } from "./dup.js";\nimport { b } from "./dup.js";\n`;
    expect(extractRelativeSpecifiers(ts, src, ".ts")).toEqual(["./dup.js"]);
  });

  it("JSX v .tsx nerozbije extrakci importů", () => {
    const src = `import React from "./react.js";\nexport const C = () => <div className="x">{1 < 2}</div>;\n`;
    expect(extractRelativeSpecifiers(ts, src, ".tsx")).toEqual(["./react.js"]);
  });
});
