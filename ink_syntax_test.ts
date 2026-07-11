import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert";
import { toFileUrl } from "jsr:@std/path";
import { compileInkModule, InkSyntaxError } from "./src/ink-syntax.ts";
import { parseModuleStaticInfo } from "./src/ast.ts";
import { parseStaticExpression } from "./src/parser.ts";
import * as TypeScript from "npm:typescript";
import type { TypeScriptAstApi } from "./src/ast.ts";

const TYPESCRIPT = TypeScript as unknown as TypeScriptAstApi;

function evaluateDefaultExport(
  source: string,
  resolveIdentifier?: (path: readonly string[]) => unknown | undefined,
): unknown {
  const compiled = compileInkModule(source, "/app/src/styles.ink");
  const moduleInfo = parseModuleStaticInfo(
    compiled.code,
    "/app/src/styles.ink",
    TYPESCRIPT,
  );
  assert(moduleInfo.defaultExportExpression !== null);
  return parseStaticExpression(
    moduleInfo.defaultExportExpression,
    resolveIdentifier,
  );
}

async function executeDefaultExport(source: string): Promise<unknown> {
  const compiled = compileInkModule(source, "/app/src/styles.ink");
  const modulePath = Deno.makeTempFileSync({ suffix: ".mjs" });
  try {
    Deno.writeTextFileSync(modulePath, compiled.code);
    const module = await import(toFileUrl(modulePath).href);
    return module.default;
  } finally {
    Deno.removeSync(modulePath);
  }
}

Deno.test(".ink compiler builds an AST for newline-separated selector blocks", () => {
  const source = `export default {
  *, *::before, *::after: {
    boxSizing: border-box
    margin: 0
    padding: 0
  }

  body: {
    fontFamily: [system-ui, sans-serif]
  }

  h1, h2, h3: {
    margin: revert
    fontSize: 1.25rem
  }
} as const
`;

  const compiled = compileInkModule(source, "/app/src/reset.ink");
  assertEquals(compiled.map, null);
  assertEquals(compiled.ast.kind, "module");
  assertEquals(compiled.ast.defaultExport.entries.length, 3);
  assertEquals(
    compiled.ast.defaultExport.entries[0].key.value,
    "*, *::before, *::after",
  );
  assertEquals(compiled.ast.defaultExport.entries[0].value.kind, "object");
  assert(!compiled.code.includes("as const"));

  assertEquals(evaluateDefaultExport(source), {
    "*, *::before, *::after": {
      boxSizing: "border-box",
      margin: 0,
      padding: 0,
    },
    body: {
      fontFamily: ["system-ui", "sans-serif"],
    },
    "h1, h2, h3": {
      margin: "revert",
      fontSize: "1.25rem",
    },
  });
});

Deno.test(".ink compiler treats only = values as expressions", () => {
  const source = `import { palette, spacing } from "./tokens.ts"

export default {
  body: {
    color: =palette.text
    gap: =spacing.md
    background: linear-gradient(90deg, red, blue)
  }
} as const
`;

  const compiled = compileInkModule(source);
  assertStringIncludes(
    compiled.code,
    'import { palette, spacing } from "./tokens.ts"',
  );
  assertStringIncludes(compiled.code, "color: palette.text");
  assertStringIncludes(
    compiled.code,
    'background: "linear-gradient(90deg, red, blue)"',
  );
  assertEquals(
    evaluateDefaultExport(source, (path) => {
      if (path.join(".") === "palette.text") return "#102030";
      if (path.join(".") === "spacing.md") return "1rem";
      return undefined;
    }),
    {
      body: {
        color: "#102030",
        gap: "1rem",
        background: "linear-gradient(90deg, red, blue)",
      },
    },
  );
});

Deno.test(".ink compiler interpolates a CSS const inside a function value", async () => {
  const source = `const pageWidth = 70rem

export default {
  page: {
    width: min(=pageWidth, 100%)
  }
} as const
`;

  const compiled = compileInkModule(source, "/app/src/page.ink");
  const pageWidthDeclaration = compiled.ast.preamble[0];
  assert(pageWidthDeclaration?.kind === "const-declaration");
  assertEquals(pageWidthDeclaration.value.kind, "css-literal");
  const moduleInfo = parseModuleStaticInfo(
    compiled.code,
    "/app/src/page.ink",
    TYPESCRIPT,
  );
  const pageWidth = moduleInfo.constInitializers.get("pageWidth");
  assert(pageWidth !== undefined);
  assertEquals(parseStaticExpression(pageWidth.initializer), "70rem");

  const page = compiled.ast.defaultExport.entries[0]?.value;
  assert(page?.kind === "object");
  const width = page.entries.find((entry) => entry.key.value === "width");
  assert(width !== undefined);
  assertEquals(
    (width.value as { kind: string }).kind,
    "interpolated-css",
  );

  assertEquals(await executeDefaultExport(source), {
    page: {
      width: "min(70rem, 100%)",
    },
  });
});

Deno.test(".ink compiler keeps a whole-value escape as an expression", async () => {
  const source = `const pageWidth = 70rem

export default {
  page: {
    width: =pageWidth
  }
}
`;

  const compiled = compileInkModule(source, "/app/src/page.ink");
  const page = compiled.ast.defaultExport.entries[0]?.value;
  assert(page?.kind === "object");
  const width = page.entries.find((entry) => entry.key.value === "width");
  assert(width !== undefined);
  assertEquals((width.value as { kind: string }).kind, "expression");
  assertEquals(await executeDefaultExport(source), {
    page: {
      width: "70rem",
    },
  });
});

Deno.test(".ink CSS consts can be initialized from expressions", async () => {
  const source = `const tokens = { pageWidth: "74rem" }
const pageWidth = =tokens.pageWidth

export default {
  page: {
    width: min(=pageWidth, 100%)
  }
}
`;

  const compiled = compileInkModule(source, "/app/src/page.ink");
  const pageWidth = compiled.ast.preamble.find((node) =>
    node.kind === "const-declaration" && node.name === "pageWidth"
  );
  assert(pageWidth?.kind === "const-declaration");
  assertEquals(pageWidth.value.kind, "expression");
  assertEquals(await executeDefaultExport(source), {
    page: { width: "min(74rem, 100%)" },
  });
});

Deno.test(".ink modules preserve ordinary JavaScript const functions", async () => {
  const source = `const double = (value) => value * 2

export default {
  page: {
    zIndex: =double(2)
  }
}
`;

  const compiled = compileInkModule(source, "/app/src/page.ink");
  assertStringIncludes(compiled.code, "const double = (value) => value * 2");
  assertEquals(await executeDefaultExport(source), {
    page: { zIndex: 4 },
  });
});

Deno.test(".ink compiler preserves Theme constructors and explicit references", async () => {
  const source = `class Theme {
  constructor(tokens) { this.tokens = tokens }
}

const fluxBlue = hsl(200 100% 50%)
const fluxYellow = hsl(60 80% 80%)
const background = linear-gradient(147deg, =fluxBlue, =fluxYellow)

const fluxLight = new Theme({
  site: {
    bg: =background
    fg: black
  }
})

export default {
  light: =fluxLight
} as const
`;

  const compiled = compileInkModule(source, "/app/src/theme.ink");
  const themeDeclaration = compiled.ast.preamble.find((node) =>
    node.kind === "const-declaration" && node.name === "fluxLight"
  );
  assert(themeDeclaration?.kind === "const-declaration");
  assertEquals(themeDeclaration.value.kind, "new-expression");

  const exportedTheme = compiled.ast.defaultExport.entries[0]?.value;
  assertEquals(exportedTheme?.kind, "expression");
  assertStringIncludes(compiled.code, "const fluxLight = new Theme({");
  assertStringIncludes(compiled.code, "light: fluxLight");

  const evaluated = await executeDefaultExport(source) as {
    light: { tokens: { site: { bg: string; fg: string } } };
  };
  assertEquals(evaluated.light.tokens, {
    site: {
      bg: "linear-gradient(147deg, hsl(200 100% 50%), hsl(60 80% 80%))",
      fg: "black",
    },
  });
});

Deno.test(".ink compiler supports multiple and braced inline interpolations", async () => {
  const source = `const startColor = "#102030"
const endColor = "#405060"
const layout = { pageWidth: "72rem" }

export default {
  page: {
    background: linear-gradient(=startColor, =endColor)
    maxWidth: calc(={layout.pageWidth.replace("rem", "px")} - 2rem)
  }
}
`;

  const compiled = compileInkModule(source, "/app/src/page.ink");
  const page = compiled.ast.defaultExport.entries[0]?.value;
  assert(page?.kind === "object");
  const entries = new Map(
    page.entries.map((entry) => [entry.key.value, entry.value]),
  );
  assertEquals(
    (entries.get("background") as { kind: string } | undefined)?.kind,
    "interpolated-css",
  );
  assertEquals(
    (entries.get("maxWidth") as { kind: string } | undefined)?.kind,
    "interpolated-css",
  );

  assertEquals(await executeDefaultExport(source), {
    page: {
      background: "linear-gradient(#102030, #405060)",
      maxWidth: "calc(72px - 2rem)",
    },
  });
});

Deno.test(".ink compiler leaves URL and query equals signs literal", async () => {
  const source = `export default {
  hero: {
    backgroundImage: url(/assets/hero.svg?theme=dark&scale=2)
    customToken: state=ready
  }
}
`;

  const compiled = compileInkModule(source, "/app/src/hero.ink");
  const hero = compiled.ast.defaultExport.entries[0]?.value;
  assert(hero?.kind === "object");
  for (const entry of hero.entries) {
    assertEquals((entry.value as { kind: string }).kind, "css-literal");
  }

  assertEquals(await executeDefaultExport(source), {
    hero: {
      backgroundImage: "url(/assets/hero.svg?theme=dark&scale=2)",
      customToken: "state=ready",
    },
  });
});

Deno.test(".ink compiler reports malformed inline expressions", () => {
  const error = assertThrows(
    () =>
      compileInkModule(
        `export default {
  page: {
    width: min(=, 100%)
  }
}`,
        "/app/src/bad-inline.ink",
      ),
    InkSyntaxError,
  );
  assertStringIncludes(error.message, "after inline '='");
});

Deno.test(".ink compiler parses structural colons in complex selector keys", () => {
  const source = `export default {
  :root: {
    colorScheme: light
  }
  a[href^="https://"]: {
    textDecoration: underline
  }
  @media (prefers-color-scheme: dark): {
    :root: {
      colorScheme: dark
    }
  }
}
`;

  assertEquals(evaluateDefaultExport(source), {
    ":root": { colorScheme: "light" },
    'a[href^="https://"]': { textDecoration: "underline" },
    "@media (prefers-color-scheme: dark)": {
      ":root": { colorScheme: "dark" },
    },
  });
});

Deno.test(".ink compiler ignores export text in comments and strings", () => {
  const source = `// export default { nope: true }
const label = "export default"

export default {
  body: {
    display: grid
  }
}
`;
  const compiled = compileInkModule(source);
  assertStringIncludes(compiled.code, 'const label = "export default"');
  assertEquals(evaluateDefaultExport(source), {
    body: { display: "grid" },
  });
});

Deno.test(".ink compiler accepts optional object commas but requires array commas", () => {
  assertEquals(
    evaluateDefaultExport(`export default {
  body: {
    display: grid,
    color: red,
  },
}`),
    { body: { display: "grid", color: "red" } },
  );

  const error = assertThrows(
    () =>
      compileInkModule(
        `export default {
  body: {
    fontFamily: ["system-ui" "sans-serif"]
  }
}`,
        "/app/src/bad.ink",
      ),
    InkSyntaxError,
  );
  assertStringIncludes(error.message, "/app/src/bad.ink:");
});

Deno.test(".ink syntax errors include the original line and column", () => {
  const error = assertThrows(
    () =>
      compileInkModule(
        `export default {
  body {
    display: grid
  }
}`,
        "/app/src/bad.ink",
      ),
    InkSyntaxError,
  );
  assertEquals(error.line, 2);
  assertEquals(error.column, 3);
  assertStringIncludes(error.message, "Expected ':'");
});
