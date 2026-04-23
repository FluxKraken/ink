import {
  assert,
  assertEquals,
  assertMatch,
  assertThrows,
} from "jsr:@std/assert";
import { dirname, join, toFileUrl } from "jsr:@std/path";
import { twMerge } from "npm:tailwind-merge";
import { inkVite } from "./src/vite.ts";
import { getNextThemeName, resolveManagedThemeEntries } from "./src/react.ts";
import ink from "./src/runtime.ts";
import {
  findNewInkDeclarations,
  parseInkCallArguments,
  parseInkConfig,
} from "./src/parser.ts";
import {
  cVar,
  font,
  Theme,
  toCssDeclaration,
  toCssGlobalRules,
  toCssRules,
  tVar,
  tw,
} from "./src/shared.ts";

(globalThis as Record<string, unknown>).__ink_tailwind_merge__ = twMerge;

const VIRTUAL_ID = "\0virtual:ink/styles.css";
const TAILWIND_RUNTIME_VIRTUAL_ID = "\0virtual:ink/tailwind-merge";
const MODULE_VIRTUAL_QUERY_KEY = "ink-module";

function scopedVirtualId(moduleId: string): string {
  return `${VIRTUAL_ID}?${MODULE_VIRTUAL_QUERY_KEY}=${
    encodeURIComponent(moduleId)
  }`;
}

function asHook(
  hook: unknown,
): (...args: any[]) => unknown {
  if (typeof hook === "function") {
    return hook as (...args: any[]) => unknown;
  }
  if (hook && typeof hook === "object" && "handler" in hook) {
    return (hook as { handler: (...args: any[]) => unknown }).handler;
  }
  throw new Error("Expected plugin hook");
}

function styleDeclarationOf(style: unknown): Record<string, unknown> {
  if (
    style &&
    typeof style === "object" &&
    "declaration" in (style as Record<string, unknown>)
  ) {
    return ((style as { declaration?: unknown }).declaration ??
      {}) as Record<string, unknown>;
  }

  return (style as Record<string, unknown> | undefined) ?? {};
}

function assertTypeCheckSucceeds(files: Record<string, string>): void {
  const tempDir = Deno.makeTempDirSync();
  const repoRoot = Deno.cwd();

  try {
    const packageJsonPath = join(repoRoot, "package.json");
    try {
      const packageJson = Deno.readTextFileSync(packageJsonPath);
      Deno.writeTextFileSync(join(tempDir, "package.json"), packageJson);
    } catch {
      // Tests that do not rely on npm resolution do not need a copied package.json.
    }

    const filePaths: string[] = [];
    for (const [relativePath, source] of Object.entries(files)) {
      const filePath = join(tempDir, relativePath);
      Deno.mkdirSync(dirname(filePath), { recursive: true });
      Deno.writeTextFileSync(filePath, source);
      filePaths.push(filePath);
    }

    const output = new Deno.Command(Deno.execPath(), {
      args: [
        "check",
        "--config",
        join(repoRoot, "deno.json"),
        "--node-modules-dir=auto",
        ...filePaths,
      ],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();

    assert(
      output.success,
      `Expected type check to succeed.\nstdout:\n${
        new TextDecoder().decode(output.stdout)
      }\nstderr:\n${new TextDecoder().decode(output.stderr)}`,
    );
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
}

function assertPackageTypesSucceed(source: string): void {
  const tempDir = Deno.makeTempDirSync();
  const repoRoot = Deno.cwd();
  const packageRoot = join(tempDir, "node_modules", "@kraken", "ink");

  try {
    Deno.mkdirSync(join(packageRoot, "dist"), { recursive: true });
    Deno.writeTextFileSync(
      join(packageRoot, "package.json"),
      JSON.stringify({
        name: "@kraken/ink",
        type: "module",
        types: "./mod.d.ts",
        exports: {
          ".": {
            types: "./mod.d.ts",
          },
        },
      }),
    );

    for (const file of ["mod.d.ts", "dist/shared.d.ts", "dist/vite.d.ts"]) {
      const sourcePath = join(repoRoot, file);
      const targetPath = join(packageRoot, file);
      Deno.mkdirSync(dirname(targetPath), { recursive: true });
      Deno.copyFileSync(sourcePath, targetPath);
    }

    Deno.writeTextFileSync(join(tempDir, "app.ts"), source);
    Deno.writeTextFileSync(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          target: "ES2020",
          skipLibCheck: true,
        },
      }),
    );

    const output = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--node-modules-dir=auto",
        "-A",
        "npm:typescript/bin/tsc",
        "-p",
        "tsconfig.json",
        "--noEmit",
      ],
      cwd: tempDir,
      stdout: "piped",
      stderr: "piped",
    }).outputSync();

    assert(
      output.success,
      `Expected package type check to succeed.\nstdout:\n${
        new TextDecoder().decode(output.stdout)
      }\nstderr:\n${new TextDecoder().decode(output.stderr)}`,
    );
  } finally {
    Deno.removeSync(tempDir, { recursive: true });
  }
}

Deno.test("vite config injects npm shim aliases for Deno projects without package.json", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.writeTextFileSync(
      join(root, "deno.json"),
      JSON.stringify({
        imports: {
          "@kraken/ink": "jsr:@kraken/ink@^0.5.13",
        },
      }),
    );

    const plugin = inkVite();
    const config = asHook(plugin.config);
    const resolved = config({
      root,
      resolve: { alias: [] },
    }) as {
      resolve?: {
        alias?: Array<{ find: string; replacement: string }>;
      };
    } | null;

    assert(resolved && resolved.resolve);
    assertEquals(resolved.resolve?.alias, [
      { find: "@kraken/ink", replacement: "@jsr/kraken__ink" },
      { find: "jsr:@kraken/ink", replacement: "@jsr/kraken__ink" },
    ]);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite extracts css when ink is imported through a file-url alias", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const runtimeSpecifier = toFileUrl(join(Deno.cwd(), "src", "index.ts"))
    .href;

  const moduleCode = `import styling, { cVar as cssVar } from ${
    JSON.stringify(runtimeSpecifier)
  };\n` +
    `const styles = new styling();\n` +
    `styles.root = [{ "--gap": "1rem" }];\n` +
    `styles.base = {\n` +
    `  card: {\n` +
    `    display: "grid",\n` +
    `    gap: cssVar("--gap"),\n` +
    `  },\n` +
    `};\n`;
  const transformed = transform(moduleCode, "/app/src/lib/aliased-ink.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new styling()"));
  assert(code.includes("styling("));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /:root\{--gap:1rem\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid;gap:var\(--gap\)\}/);
});

Deno.test("vite resolves aliased helper imports from file-url ink modules", () => {
  const root = Deno.makeTempDirSync();
  const runtimeSpecifier = toFileUrl(join(Deno.cwd(), "src", "index.ts"))
    .href;

  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const transform = asHook(plugin.transform);
    const themesId = `${root}/src/lib/themes.ts`;
    const pageId = `${root}/src/routes/+page.svelte`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.mkdirSync(`${root}/src/routes`, { recursive: true });
    Deno.writeTextFileSync(
      themesId,
      `import { Theme as InkTheme } from ${JSON.stringify(runtimeSpecifier)};\n` +
        `const dark = new InkTheme({ bg: "black", fg: "white" });\n` +
        `export default { dark } as const;\n`,
    );

    const source = `<script lang="ts">\n` +
      `import styling, { tVar as inkVar } from ${
        JSON.stringify(runtimeSpecifier)
      };\n` +
      `import Themes from "../lib/themes.ts";\n` +
      `const styles = new styling();\n` +
      `styles.themes = { default: Themes.dark };\n` +
      `styles.base = { header: { backgroundColor: inkVar.bg, color: inkVar.fg } };\n` +
      `</script>\n` +
      `<header class={styles().header()}>hi</header>`;

    configResolved({ root, resolve: { alias: [] } });

    const transformed = transform(source, pageId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    assertMatch(transformed.code as string, /--bg:black/);
    assertMatch(transformed.code as string, /background-color:var\(--bg\)/);
    assertMatch(transformed.code as string, /color:var\(--fg\)/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("injects component CSS for direct ink usage in svelte", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source = `<script lang="ts">\nimport ink from "@kraken/ink";\n` +
    `const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });\n` +
    `</script>\n\n<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, "/app/src/routes/+page.svelte");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes('import "virtual:ink/styles.css";'));
  assert(code.includes("<style>"));
  assertMatch(code, /:global\(\.ink_[a-z0-9]+\)\{display:grid;gap:1rem\}/);
});

Deno.test("svelte style block keeps @media outside :global wrappers", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source = `<script lang="ts">\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = ink({\n` +
    `  base: {\n` +
    `    container: {\n` +
    `      display: "grid",\n` +
    `      "@media (width < 70rem)": {\n` +
    `        gap: 0,\n` +
    `      },\n` +
    `    },\n` +
    `  }\n` +
    `});\n` +
    `</script>\n\n` +
    `<main class={styles().container()}></main>`;

  const transformed = transform(
    source,
    "/app/src/lib/components/Container.svelte",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes(":global(@media"));
  assertMatch(
    code,
    /@media \(width < 70rem\)\{:global\(\.ink_[a-z0-9]+\)\{gap:0px\}\}/,
  );
});

Deno.test("merges ink component CSS into an existing svelte style block", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source = `<script lang="ts">\nimport ink from "@kraken/ink";\n` +
    `const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });\n` +
    `</script>\n\n` +
    `<style>\n.card-shell { padding: 1rem; }\n</style>\n\n` +
    `<div class={styles().card()}></div>`;

  const transformed = transform(source, "/app/src/lib/components/Card.svelte");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertEquals((code.match(/<style\b/g) ?? []).length, 1);
  assert(code.includes(".card-shell { padding: 1rem; }"));
  assertMatch(code, /:global\(\.ink_[a-z0-9]+\)\{display:grid;gap:1rem\}/);
});

Deno.test("injects virtual stylesheet import and extracts css for direct ink usage in astro", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const source = `---\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });\n` +
    `---\n\n` +
    `<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, "/app/src/pages/index.astro");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(
    code,
    /^---\nimport "virtual:ink\/styles\.css";\nimport ink from "@kraken\/ink";/,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(loaded as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("injects module-scoped virtual stylesheet imports for astro ink usage", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const id = "/app/src/components/card.astro";

  const source = `---\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });\n` +
    `---\n\n` +
    `<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, id);
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(
    code.includes(
      `virtual:ink/styles.css?${MODULE_VIRTUAL_QUERY_KEY}=${
        encodeURIComponent(id)
      }`,
    ),
  );

  const scopedCss = load(scopedVirtualId(id));
  assertEquals(typeof scopedCss, "string");
  assertMatch(scopedCss as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("injects virtual stylesheet import in astro files that only import ink styles", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source = `---\n` +
    `import { styles } from "./styles.ts";\n` +
    `---\n\n` +
    `<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, "/app/src/pages/home.astro");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(
    code.includes(
      '---\nimport "virtual:ink/styles.css";\nimport { styles } from "./styles.ts";',
    ),
  );
});

Deno.test("injects virtual stylesheet import and extracts css for new ink() usage in astro", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const source = `---\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { card: { display: "grid", gap: "1rem" } };\n` +
    `---\n\n` +
    `<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, "/app/src/pages/new-ink.astro");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(
    code,
    /^---\nimport "virtual:ink\/styles\.css";\nimport ink from "@kraken\/ink";/,
  );
  assert(!code.includes("new ink()"));

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(loaded as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("injects plain virtual import when astro transform input is already JS-shaped", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source =
    `import { createComponent as $$createComponent } from "astro/runtime/server/index.js";\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });\n`;

  const transformed = transform(source, "/app/src/pages/js-shaped.astro");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(
    code.startsWith(
      'import "virtual:ink/styles.css";\nimport { createComponent as $$createComponent }',
    ),
  );
  assert(!code.startsWith("---\n"));
});

Deno.test("injects plain virtual import when JS-shaped astro input uses new ink()", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source =
    `import { createComponent as $$createComponent } from "astro/runtime/server/index.js";\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { card: { display: "grid", gap: "1rem" } };\n`;

  const transformed = transform(
    source,
    "/app/src/pages/js-shaped-new-ink.astro",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(
    code.startsWith(
      'import "virtual:ink/styles.css";\nimport { createComponent as $$createComponent }',
    ),
  );
  assert(!code.startsWith("---\n"));
  assert(!code.includes("new ink()"));
});

Deno.test("module-scoped virtual CSS survives early shared virtual load ordering", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const layoutId = "/app/src/layouts/main.astro";
  const componentId = "/app/src/components/header.astro";

  const layoutSource = `---\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.global = { body: { color: "white" } };\n` +
    `---\n\n` +
    `<slot />`;

  const componentSource = `---\n` +
    `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { card: { display: "grid", gap: "1rem" } };\n` +
    `---\n\n` +
    `<div class={styles().card()}>hi</div>`;

  const transformedLayout = transform(layoutSource, layoutId);
  assert(
    transformedLayout && typeof transformedLayout === "object" &&
      "code" in transformedLayout,
  );

  const earlySharedCss = load(VIRTUAL_ID);
  assertEquals(typeof earlySharedCss, "string");
  assert((earlySharedCss as string).includes("body{color:white}"));

  const transformedComponent = transform(componentSource, componentId);
  assert(
    transformedComponent && typeof transformedComponent === "object" &&
      "code" in transformedComponent,
  );

  const componentCode = transformedComponent.code as string;
  assert(componentCode.includes(
    `virtual:ink/styles.css?${MODULE_VIRTUAL_QUERY_KEY}=${
      encodeURIComponent(componentId)
    }`,
  ));

  const scopedCss = load(scopedVirtualId(componentId));
  assertEquals(typeof scopedCss, "string");
  assertMatch(scopedCss as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("limits transforms to src/app by default", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.mkdirSync(`${root}/app`, { recursive: true });
    Deno.mkdirSync(`${root}/node_modules/pkg`, { recursive: true });

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    card: { display: "grid" },\n` +
      `  },\n` +
      `});`;

    const transformedSrc = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformedSrc && typeof transformedSrc === "object" &&
        "code" in transformedSrc,
    );

    const transformedApp = transform(moduleCode, `${root}/app/routes.tsx`);
    assert(
      transformedApp && typeof transformedApp === "object" &&
        "code" in transformedApp,
    );

    const transformedNodeModules = transform(
      moduleCode,
      `${root}/node_modules/pkg/app.ts`,
    );
    assertEquals(transformedNodeModules, null);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extends transform scope with ink.config.ts include paths", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.mkdirSync(`${root}/packages/ui`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  include: ["./packages/ui"],\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    card: { display: "grid" },\n` +
      `  },\n` +
      `});`;

    const transformedIncluded = transform(
      moduleCode,
      `${root}/packages/ui/button.ts`,
    );
    assert(
      transformedIncluded && typeof transformedIncluded === "object" &&
        "code" in transformedIncluded,
    );

    const transformedUnincluded = transform(
      moduleCode,
      `${root}/packages/other/button.ts`,
    );
    assertEquals(transformedUnincluded, null);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("nested vite roots load parent ink.config.ts and transform vite-root svelte files", () => {
  const root = Deno.makeTempDirSync();
  const viteRoot = `${root}/src/mainview`;

  try {
    Deno.mkdirSync(viteRoot, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  defaultUnit: "rem",\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root: viteRoot, resolve: { alias: [] } });

    const source = `<script lang="ts">\n` +
      `import ink from "@kraken/ink";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  wrapper: {\n` +
      `    display: "grid",\n` +
      `    gap: 1,\n` +
      `  },\n` +
      `};\n` +
      `</script>\n\n` +
      `<div class={styles().wrapper()}></div>`;

    const transformed = transform(source, `${viteRoot}/App.svelte`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(code.includes('import "virtual:ink/styles.css";'));
    assert(code.includes('"defaultUnit":"rem"'));
    assert(!code.includes("new ink()"));
    assertMatch(code, /:global\(\.ink_[a-z0-9]+\)\{display:grid;gap:1rem\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("cVar() formats css variable references", () => {
  assertEquals(
    toCssDeclaration("backgroundColor", cVar("--background")),
    "background-color:var(--background)",
  );
  assertEquals(
    toCssDeclaration("backgroundColor", cVar("--background", "#111")),
    "background-color:var(--background, #111)",
  );
  assertEquals(
    toCssDeclaration("padding", cVar("--space", 8)),
    "padding:var(--space, 8px)",
  );
  assertEquals(
    toCssDeclaration("fontWeight", cVar("--weight", 600)),
    "font-weight:var(--weight, 600)",
  );
});

Deno.test("Theme and tVar map friendly theme tokens to css custom properties", () => {
  const theme = new Theme({
    headerBG: "black",
    "--header-fg": "white",
  });

  assertEquals(theme.vars, {
    "--header-bg": "black",
    "--header-fg": "white",
  });
  assertEquals(
    toCssDeclaration("backgroundColor", tVar.headerBG),
    "background-color:var(--header-bg)",
  );
  assertEquals(
    tVar.eval("linear-gradient(147deg, {headerBG}, {headerFG})"),
    "linear-gradient(147deg, var(--header-bg), var(--header-fg))",
  );
});

Deno.test("ThemeProvider theme resolution maps root and class-backed scopes", () => {
  assertEquals(
    resolveManagedThemeEntries({
      default: new Theme({ surface: "#fff" }),
      dark: new Theme({ surface: "#111" }),
      ".blue": new Theme({ surface: "#00f" }),
    }),
    [
      { name: "default", className: null },
      { name: "dark", className: "dark" },
      { name: ".blue", className: "blue" },
    ],
  );
  assertEquals(
    getNextThemeName(
      resolveManagedThemeEntries({
        default: new Theme({ surface: "#fff" }),
        dark: new Theme({ surface: "#111" }),
        blue: new Theme({ surface: "#00f" }),
      }),
      "dark",
    ),
    "blue",
  );
});

Deno.test("ThemeProvider rejects complex theme selectors it cannot manage", () => {
  assertThrows(
    () =>
      resolveManagedThemeEntries({
        default: new Theme({ surface: "#fff" }),
        '[data-theme="dark"]': new Theme({ surface: "#111" }),
      }),
    Error,
    "ThemeProvider can only manage default/root themes and class-backed theme scopes.",
  );
});

Deno.test("font() formats quoted font-family lists for declarations and themes", () => {
  assertEquals(
    font(["Inter Variable", "system-ui", "sans-serif"]),
    `"Inter Variable", system-ui, sans-serif`,
  );
  assertEquals(font.display, cVar("--font-display"));
  assertEquals(
    toCssDeclaration(
      "fontFamily",
      font(["Inter Variable", "system-ui", "sans-serif"]),
    ),
    `font-family:"Inter Variable", system-ui, sans-serif`,
  );

  const theme = new Theme({
    fontDisplay: font(["Inter Variable", "system-ui", "sans-serif"]),
  });
  assertEquals(
    toCssGlobalRules({
      ":root": theme.vars,
    }),
    [`:root{--font-display:"Inter Variable", system-ui, sans-serif}`],
  );
});

Deno.test("parser supports Fontsource fonts and font token references", () => {
  const parsed = parseInkCallArguments(`{
    fonts: [
      { name: "Bungee", varName: "display" }
    ],
    base: {
      header: {
        fontFamily: font.display
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.imports, [`"@fontsource/bungee"`]);
  assertEquals(parsed.root, [{ "--font-display": "Bungee, system-ui" }]);
  assertEquals(
    styleDeclarationOf(parsed.base.header).fontFamily,
    cVar("--font-display"),
  );
});

Deno.test("toCssDeclaration and toCssRules support configurable defaultUnit", () => {
  assertEquals(
    toCssDeclaration("fontSize", 1, { defaultUnit: "rem" }),
    "font-size:1rem",
  );
  assertEquals(
    toCssDeclaration("lineHeight", 1.4, { defaultUnit: "rem" }),
    "line-height:1.4",
  );
  assertEquals(
    toCssDeclaration("padding", cVar("--space", 2), { defaultUnit: "rem" }),
    "padding:var(--space, 2rem)",
  );

  const rules = toCssRules("test", { marginBlock: 2 }, { defaultUnit: "ch" });
  assert(rules.includes(".test{margin-block:2ch}"));
});

Deno.test("toCssDeclaration treats tokenized transition arrays as single shorthands", () => {
  assertEquals(
    toCssDeclaration("transition", [
      "text-decoration-color",
      "0.2s",
      "ease-in-out",
    ]),
    "transition:text-decoration-color 0.2s ease-in-out",
  );
  assertEquals(
    toCssDeclaration("transition", ["opacity", "0.2s", "linear"]),
    "transition:opacity 0.2s linear",
  );
});

Deno.test("toCssDeclaration quotes string content values and preserves raw content tokens", () => {
  assertEquals(toCssDeclaration("content", ""), `content:""`);
  assertEquals(toCssDeclaration("content", "- "), `content:"- "`);
  assertEquals(toCssDeclaration("content", "''"), `content:''`);
  assertEquals(toCssDeclaration("content", "open-quote"), `content:open-quote`);
  assertEquals(
    toCssDeclaration("content", "attr(data-label)"),
    `content:attr(data-label)`,
  );
});

Deno.test("toCssRules serializes empty content strings in pseudo elements", () => {
  assertEquals(
    toCssRules("test", {
      after: {
        content: "",
        backgroundColor: "red",
      },
    }),
    [`.test::after{content:\"\";background-color:red}`],
  );
});

Deno.test("toCssDeclaration wraps imported image paths in url() for image properties", () => {
  assertEquals(
    toCssDeclaration("background", "/src/lib/assets/bg.png"),
    'background:url("/src/lib/assets/bg.png")',
  );
  assertEquals(
    toCssDeclaration("backgroundImage", "./bg.webp?url"),
    'background-image:url("./bg.webp?url")',
  );
  assertEquals(
    toCssDeclaration("background", "linear-gradient(147deg, red, blue)"),
    "background:linear-gradient(147deg, red, blue)",
  );
});

Deno.test("toCssRules supports nested selectors and nested @media/@container blocks", () => {
  const rules = toCssRules("test", {
    fontSize: "1.25rem",
    ul: {
      display: "flex",
      flexWrap: "wrap",
      gap: "0.5rem",
      "@media (width < 20rem)": {
        ul: { display: "grid" },
      },
      "@container nav (inline-size > 30rem)": {
        "a:hover": { textDecoration: "underline" },
      },
    },
    li: {
      flex: 1,
    },
    hover: {
      opacity: 0.8,
    },
  });

  assert(rules.includes(".test{font-size:1.25rem}"));
  assert(rules.includes(".test ul{display:flex;flex-wrap:wrap;gap:0.5rem}"));
  assert(rules.includes("@media (width < 20rem){.test ul ul{display:grid}}"));
  assert(
    rules.includes(
      "@container nav (inline-size > 30rem){.test ul a:hover{text-decoration:underline}}",
    ),
  );
  assert(rules.includes(".test li{flex:1}"));
  assert(rules.includes(".test:hover{opacity:0.8}"));
});

Deno.test("toCssRules resolves breakpoint shorthand and ranges", () => {
  const rules = toCssRules(
    "test",
    {
      display: "grid",
      "@sm": {
        gap: "1rem",
      },
      "!@sm": {
        padding: "2rem",
      },
      "@(xs,xl)": {
        gridTemplateColumns: "1fr 1fr",
      },
    },
    {
      breakpoints: {
        xs: "30rem",
        sm: "40rem",
        xl: "80rem",
      },
    },
  );

  assert(rules.includes(".test{display:grid}"));
  assert(rules.includes("@media (width >= 40rem){.test{gap:1rem}}"));
  assert(rules.includes("@media (width <= 40rem){.test{padding:2rem}}"));
  assert(
    rules.includes(
      "@media (30rem < width < 80rem){.test{grid-template-columns:1fr 1fr}}",
    ),
  );
});

Deno.test("toCssRules emits base declarations before breakpoint rules for override semantics", () => {
  const rules = toCssRules(
    "test",
    {
      textAlign: "left",
      "@sm": {
        textAlign: "justify",
      },
    },
    {
      breakpoints: {
        sm: "25rem",
      },
    },
  );

  assertEquals(rules[0], ".test{text-align:left}");
  assertEquals(rules[1], "@media (width >= 25rem){.test{text-align:justify}}");
});

Deno.test("toCssRules resolves numeric breakpoint aliases like 2xs/2xl", () => {
  const rules = toCssRules(
    "test",
    {
      "@2xs": {
        gap: "0.25rem",
      },
      "@(2xs,2xl)": {
        gridTemplateColumns: "1fr 1fr",
      },
    },
    {
      breakpoints: {
        "2xs": "20rem",
        "2xl": "96rem",
      },
    },
  );

  assert(rules.includes("@media (width >= 20rem){.test{gap:0.25rem}}"));
  assert(
    rules.includes(
      "@media (20rem < width < 96rem){.test{grid-template-columns:1fr 1fr}}",
    ),
  );
});

Deno.test("toCssRules resolves container shorthand and ranges", () => {
  const rules = toCssRules(
    "test",
    {
      "@card": { backgroundColor: "blue" },
      "@(cardMin,cardMax)": { color: "white" },
    },
    {
      containers: {
        card: { type: "inline-size", rule: "width < 20rem" },
        cardMin: { type: "inline-size", rule: "12rem <= width" },
        cardMax: { type: "inline-size", rule: "width < 24rem" },
      },
    },
  );

  assert(
    rules.includes(
      "@container card (width < 20rem){.test{background-color:blue}}",
    ),
  );
  assert(
    rules.includes(
      "@container (12rem <= width) and (width < 24rem){.test{color:white}}",
    ),
  );
});

Deno.test("toCssGlobalRules supports @scope with nested selectors", () => {
  const rules = toCssGlobalRules({
    "@scope": {
      selector: ".dark",
      ":scope": {
        color: "white",
      },
      ".accent": {
        color: "cyan",
      },
    },
  });

  assertEquals(rules, [
    "@scope (.dark){:scope{color:white}.accent{color:cyan}}",
  ]);
});

Deno.test("parser accepts quoted nested selectors and nested @media/@container", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      mainNavigation: {
        fontSize: "1.25rem",
        "ul": {
          display: "flex",
          "@media (width < 20rem)": {
            "ul": { display: "grid" }
          },
          "@container nav (inline-size > 30rem)": {
            "a:hover": { textDecoration: "underline" }
          }
        }
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.base.mainNavigation).fontSize,
    "1.25rem",
  );
});

Deno.test("parser merges style declaration arrays in ink config", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      myButton: [
        { fontSize: "1.25rem", padding: "1rem" },
        { background: "black", color: "white", padding: "0.5rem" }
      ]
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.myButton);
  assertEquals(declaration.fontSize, "1.25rem");
  assertEquals(declaration.background, "black");
  assertEquals(declaration.color, "white");
  assertEquals(declaration.padding, "0.5rem");
});

Deno.test("parser supports space-delimited property arrays", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      pageWrapper: {
        display: "grid",
        gridTemplateRows: ["auto", "1fr", "auto"]
      }
    }
  }`);

  assert(parsed !== null);
  const rows = styleDeclarationOf(parsed.base.pageWrapper).gridTemplateRows;
  assert(Array.isArray(rows));
  assertEquals(rows, ["auto", "1fr", "auto"]);
});

Deno.test("parser supports bare identifier values in style declarations", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      pageWrapper: {
        fontSize: revert,
        borderStyle: solid,
        color: currentColor,
        gridTemplateRows: [auto, "1fr", auto]
      }
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.pageWrapper);
  assertEquals(declaration.fontSize, "revert");
  assertEquals(declaration.borderStyle, "solid");
  assertEquals(declaration.color, "currentColor");
  assertEquals(declaration.gridTemplateRows, ["auto", "1fr", "auto"]);
});

Deno.test("parser supports bare dashed identifier values in style declarations", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      pageWrapper: {
        width: fit-content,
        fontFamily: [ui-monospace, monospace],
        animationTimingFunction: ease-in-out
      }
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.pageWrapper);
  assertEquals(declaration.width, "fit-content");
  assertEquals(declaration.fontFamily, ["ui-monospace", "monospace"]);
  assertEquals(declaration.animationTimingFunction, "ease-in-out");
});

Deno.test("parser supports font() helper values", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      pageWrapper: {
        fontFamily: font(["Inter Variable", system-ui, sans-serif])
      }
    },
    themes: {
      default: new Theme({
        fontDisplay: font(["Inter Variable", "system-ui", "sans-serif"])
      })
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.pageWrapper);
  assertEquals(
    declaration.fontFamily,
    `"Inter Variable", system-ui, sans-serif`,
  );
  assertEquals(parsed.root, [{
    "--font-display": `"Inter Variable", system-ui, sans-serif`,
  }]);
});

Deno.test("parser supports @apply merge lists with local declarations", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      pageWrapper: {
        display: "grid",
        "@apply": [
          { backgroundColor: "#4f4f4f", color: "black" },
          { gridTemplateRows: ["auto", "1fr", "auto"] }
        ],
        color: "#00aaff"
      }
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.pageWrapper);
  assertEquals(declaration.display, "grid");
  assertEquals(declaration.backgroundColor, "#4f4f4f");
  assertEquals(declaration.color, "#00aaff");
  assertEquals(declaration.gridTemplateRows, ["auto", "1fr", "auto"]);
});

Deno.test("parser supports layered @apply rule objects in merge lists", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      contentWrapper: {
        "@apply": [
          { marginInline: "auto" },
          {
            rules: {
              "h1, h2": {
                margin: revert,
                fontWeight: revert
              }
            },
            layer: "typography"
          }
        ],
        color: "black"
      }
    }
  }`);

  assert(parsed !== null);
  const declaration = styleDeclarationOf(parsed.base.contentWrapper);
  assertEquals(declaration.marginInline, "auto");
  assertEquals(declaration.color, "black");
  assertEquals(declaration["@layer typography"], {
    "h1, h2": {
      margin: "revert",
      fontWeight: "revert",
    },
  });
});

Deno.test("parser supports tw() in @apply and direct style entries", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      nav: {
        "@apply": tw("w-fit justify-self-end font-mono font-semibold text-xl"),
        backgroundColor: "#00AAFF",
        color: "white"
      },
      navList: {
        "@apply": tw(["flex", "flex-wrap", "gap-2"])
      },
      navItem: tw("flex-1 basis-[content] border-x-4 px-4 text-center"),
      navLink: tw(["hover:underline", "underline-offset-6"])
    }
  }`);

  assert(parsed !== null);
  assertEquals(styleDeclarationOf(parsed.base.nav).backgroundColor, "#00AAFF");
  assertEquals(styleDeclarationOf(parsed.base.nav).color, "white");
  assertEquals(parsed.base.nav.tailwindClassNames, [
    "w-fit justify-self-end font-mono font-semibold text-xl",
  ]);
  assertEquals(parsed.base.navList.tailwindClassNames, [
    "flex",
    "flex-wrap",
    "gap-2",
  ]);
  assertEquals(parsed.base.navItem.declaration, {});
  assertEquals(parsed.base.navItem.tailwindClassNames, [
    "flex-1 basis-[content] border-x-4 px-4 text-center",
  ]);
  assertEquals(parsed.base.navLink.tailwindClassNames, [
    "hover:underline",
    "underline-offset-6",
  ]);
});

Deno.test("parser prefixes nested hover @apply tw() classes", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      navLink: {
        hover: {
          "@apply": tw("underline underline-offset-2 underline-offset-6")
        }
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(styleDeclarationOf(parsed.base.navLink), {
    hover: {},
  });
  assertEquals(parsed.base.navLink.tailwindClassNames, [
    "hover:underline hover:underline-offset-2 hover:underline-offset-6",
  ]);
});

Deno.test("parser collects @import paths from stylesheet blocks", () => {
  const parsed = parseInkCallArguments(`{
    global: {
      "@import": ["./styles/reset.css", "$lib/styles/theme.css"]
    },
    base: {
      pageWrapper: {
        display: "grid"
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.imports, [
    `"./styles/reset.css"`,
    `"$lib/styles/theme.css"`,
  ]);
  assertEquals(parsed.global, {});
  assertEquals(
    styleDeclarationOf(parsed.base.pageWrapper).display,
    "grid",
  );
});

Deno.test("parser supports @set with configured containers", () => {
  const parsed = parseInkCallArguments(
    `{
      base: {
        mainContainer: {
          "@set": "card"
        },
        card: {
          "@card": {
            backgroundColor: "blue"
          }
        }
      }
    }`,
    {
      containers: {
        card: { type: "inline-size", rule: "width < 20rem" },
      },
    },
  );

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.base.mainContainer).containerName,
    "card",
  );
  assertEquals(
    styleDeclarationOf(parsed.base.mainContainer).containerType,
    "inline-size",
  );
});

Deno.test("parser accepts defaults variant selections", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      myButton: {}
    },
    variant: {
      size: {
        sm: { myButton: { fontSize: "0.8rem" } },
        md: { myButton: { fontSize: "1rem" } }
      }
    },
    defaults: {
      size: "md"
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.defaults, { size: "md" });
});

Deno.test("parser accepts boolean defaults variant selections", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      content: {}
    },
    variant: {
      prose: {
        true: { content: { fontWeight: 700 } },
        false: { content: { fontWeight: 400 } }
      }
    },
    defaults: {
      prose: false
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.defaults, { prose: false });
});

Deno.test("TypeScript completions include camelCase CSS properties in style declarations", async () => {
  const ts = await import("npm:typescript");
  const cwd = Deno.cwd();
  const fileName = join(cwd, "completion-test.ts");
  const source = `import ink from "./mod.ts";

const styles = new ink();
styles.base = {
  nav: {
    text
  },
  navLink: {
    hover: {
      text
    },
  },
};
`;
  const files = new Map<string, string>([[fileName, source]]);
  const compilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    strict: true,
    skipLibCheck: true,
  };
  const host = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "0",
    getScriptSnapshot: (name: string) => {
      const text = files.get(name) ?? ts.sys.readFile(name);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => cwd,
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: (options: typeof compilerOptions) =>
      ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
  };
  const service = ts.createLanguageService(host);
  const positions = [...source.matchAll(/text/g)].map((match) =>
    (match.index ?? 0) + "text".length
  );

  for (const position of positions) {
    const completions = service.getCompletionsAtPosition(
      fileName,
      position,
      {},
    );
    const names = new Set(
      completions?.entries.map((entry: { name: string }) => entry.name) ?? [],
    );

    assert(names.has("textAlign"));
    assert(names.has("textDecoration"));
    assert(names.has("textUnderlineOffset"));
  }
});

Deno.test("type checking accepts boolean variant selections in route-like modules", () => {
  const runtimeSpecifier = toFileUrl(join(Deno.cwd(), "src", "index.ts"))
    .href;
  const source = `import ink from ${JSON.stringify(runtimeSpecifier)};\n` +
    `const builderStyles = new ink();\n` +
    `builderStyles.base = { content: { color: "black", fontWeight: 400 } };\n` +
    `builderStyles.variant = {\n` +
    `  prose: {\n` +
    `    true: { content: { color: "black", fontWeight: 700 } },\n` +
    `    false: { content: { color: "black", fontWeight: 400 } },\n` +
    `  },\n` +
    `};\n` +
    `builderStyles.content({ prose: true });\n` +
    `builderStyles.content({ prose: false });\n` +
    `const inlineStyles = ink({\n` +
    `  base: { content: { color: "black", fontWeight: 400 } },\n` +
    `  variant: {\n` +
    `    prose: {\n` +
    `      true: { content: { color: "black", fontWeight: 700 } },\n` +
    `      false: { content: { color: "black", fontWeight: 400 } },\n` +
    `    },\n` +
    `  },\n` +
    `});\n` +
    `inlineStyles().content({ prose: true });\n` +
    `inlineStyles().content({ prose: false });\n`;

  assertTypeCheckSucceeds({
    "component.tsx": source,
    "src/routes/+page.ts": source,
    "src/pages/index.ts": source,
  });
});

Deno.test("type checking accepts Fontsource fonts and font token accessors", () => {
  assertTypeCheckSucceeds({
    "src/app.ts": `
      import ink, { font } from "@kraken/ink";

      const styles = new ink();
      styles.fonts = [{ name: "Bungee", varName: "display" }];
      styles.base = {
        header: {
          fontFamily: font.display,
        },
      };

      styles.header();
    `,
  });
});

Deno.test("published types accept new ink() Fontsource font assignments", () => {
  assertPackageTypesSucceed(`
    import ink, { font } from "@kraken/ink";

    const styles = new ink();
    styles.fonts = [{ name: "Bungee", varName: "display" }];
    styles.base = {
      header: {
        fontFamily: font.display,
      },
    };

    styles.header();
  `);
});

Deno.test("type checking accepts ThemeProvider and useTheme from the react entrypoint", () => {
  const runtimeSpecifier = toFileUrl(join(Deno.cwd(), "src", "index.ts"))
    .href;
  const reactSpecifier = toFileUrl(join(Deno.cwd(), "react.ts")).href;
  const source = `import { createElement } from "npm:react";\n` +
    `import ink from ${JSON.stringify(runtimeSpecifier)};\n` +
    `import { ThemeProvider, useTheme } from ${
      JSON.stringify(reactSpecifier)
    };\n` +
    `const styles = new ink();\n` +
    `styles.themes = {\n` +
    `  default: new ink.Theme({ surface: "#fff" }),\n` +
    `  dark: new ink.Theme({ surface: "#111" }),\n` +
    `  blue: new ink.Theme({ surface: "#00f" }),\n` +
    `};\n` +
    `function Child() {\n` +
    `  const { theme, themes, setTheme, toggleTheme } = useTheme();\n` +
    `  setTheme("blue");\n` +
    `  toggleTheme();\n` +
    `  return createElement("div", null, theme, themes.join(","));\n` +
    `}\n` +
    `export const app = createElement(\n` +
    `  ThemeProvider,\n` +
    `  { styles, defaultTheme: "default", hotkey: "mod+shift+t" },\n` +
    `  createElement(Child),\n` +
    `);\n`;

  assertTypeCheckSucceeds({
    "src/routes/__root.tsx": source,
  });
});

Deno.test("parser accepts root entries", () => {
  const parsed = parseInkCallArguments(`{
    root: [
      {
        "--background": "#111",
        "--text-color": "#fff"
      },
      {
        layer: "theme",
        vars: {
          "--accent": "deepskyblue"
        }
      }
    ]
  }`);

  assert(parsed !== null);
  assertEquals(parsed.root, [
    {
      "--background": "#111",
      "--text-color": "#fff",
    },
    {
      layer: "theme",
      vars: {
        "--accent": "deepskyblue",
      },
    },
  ]);
});

Deno.test("parser keeps rootVars as a compatibility alias", () => {
  const parsed = parseInkCallArguments(`{
    rootVars: [
      {
        "--background": "#111"
      }
    ]
  }`);

  assert(parsed !== null);
  assertEquals(parsed.root, [
    {
      "--background": "#111",
    },
  ]);
  assertEquals(parsed.rootVars, parsed.root);
});

Deno.test("parser expands themes and resolves tVar references", () => {
  const parsed = parseInkCallArguments(`{
    themes: {
      default: {
        headerBG: "black"
      },
      dark: {
        headerBG: "white"
      }
    },
    base: {
      header: {
        backgroundColor: tVar.headerBG
      }
    }
  }`);

  assert(parsed !== null);
  const darkScope = parsed.global?.["@scope (.dark)"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  assertEquals(parsed.root, [
    {
      "--header-bg": "black",
    },
  ]);
  assertEquals(
    darkScope?.[":scope"]?.["--header-bg"],
    "white",
  );
  assertEquals(
    styleDeclarationOf(parsed.base.header).backgroundColor,
    cVar("--header-bg"),
  );
});

Deno.test("parser expands themes into prefers-color-scheme rules", () => {
  const parsed = parseInkCallArguments(
    `{
      themes: {
        default: {
          headerBG: "black"
        },
        dark: {
          headerBG: "white"
        }
      },
      base: {
        header: {
          backgroundColor: tVar.headerBG
        }
      }
    }`,
    { themeMode: "color-scheme" },
  );

  assert(parsed !== null);
  const darkMedia = parsed.global?.["@media (prefers-color-scheme: dark)"] as
    | Record<string, Record<string, unknown>>
    | undefined;
  assertEquals(parsed.root, [
    {
      "--header-bg": "black",
    },
  ]);
  assertEquals(
    darkMedia?.[":root"]?.["--header-bg"],
    "white",
  );
  assertEquals(
    styleDeclarationOf(parsed.base.header).backgroundColor,
    cVar("--header-bg"),
  );
});

Deno.test("parser resolves tVar.eval() theme templates", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      hero: {
        backgroundImage: tVar.eval("linear-gradient(147deg, {bgGradient1}, {bgGradient2})")
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.base.hero).backgroundImage,
    "linear-gradient(147deg, var(--bg-gradient1), var(--bg-gradient2))",
  );
});

Deno.test("parser resolves multiline tVar.eval() theme templates", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      hero: {
        backgroundImage: tVar.eval(
          "linear-gradient(147deg, {bgGradient1}, {bgGradient2})"
        )
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.base.hero).backgroundImage,
    "linear-gradient(147deg, var(--bg-gradient1), var(--bg-gradient2))",
  );
});

Deno.test("parser accepts trailing comma in tVar.eval() calls", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      hero: {
        backgroundImage: tVar.eval(
          "linear-gradient(147deg, {bgGradient1}, {bgGradient2})",
        )
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.base.hero).backgroundImage,
    "linear-gradient(147deg, var(--bg-gradient1), var(--bg-gradient2))",
  );
});

Deno.test("parser accepts trailing commas in Theme() and cVar() calls", () => {
  const parsed = parseInkCallArguments(`{
    themes: {
      default: new Theme({
        bg: "#123456",
      },),
    },
    base: {
      hero: {
        backgroundColor: cVar("--bg",),
        padding: cVar("--space", 8,),
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.root, [
    {
      "--bg": "#123456",
    },
  ]);
  assertEquals(
    styleDeclarationOf(parsed.base.hero).backgroundColor,
    cVar("--bg"),
  );
  assertEquals(
    styleDeclarationOf(parsed.base.hero).padding,
    cVar("--space", 8),
  );
});

Deno.test("runtime injects root into :root and layered :root", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink({
      root: [
        {
          "--background": "#111",
        },
        {
          layer: "theme",
          vars: {
            "--accent": "deepskyblue",
          },
        },
      ],
    });

    styles();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assert(text.includes(":root{--background:#111}"));
    assert(text.includes("@layer theme{:root{--accent:deepskyblue}}"));
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime injects Fontsource imports and font root variables", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink({
      fonts: [{ name: "Bungee", varName: "display" }],
      base: {
        header: {
          fontFamily: font.display,
        },
      },
    });

    styles().header();
    const importTag = fakeDocument.getElementById("__ink_runtime_imports");
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    assertEquals(importTag?.textContent, '@import "@fontsource/bungee";');
    const text = styleTag?.textContent ?? "";
    assert(text.includes(":root{--font-display:Bungee, system-ui}"));
    assertMatch(text, /\.ink_[a-z0-9]+\{font-family:var\(--font-display\)\}/);
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime injects layered @apply rules for class selectors", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink({
      base: {
        contentWrapper: {
          "@apply": {
            rules: {
              "h1, h2": {
                margin: "revert",
                fontWeight: "revert",
              },
            },
            layer: "typography",
          },
          color: "black",
        },
      },
    });

    styles();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assertMatch(text, /\.ink_[a-z0-9]+\{color:black\}/);
    assertMatch(
      text,
      /@layer typography\{\.ink_[a-z0-9]+ h1, \.ink_[a-z0-9]+ h2\{margin:revert;font-weight:revert\}\}/,
    );
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime injects configured layer order before layered rules", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink(
      {
        base: {
          contentWrapper: {
            "@apply": {
              rules: {
                "h1, h2": {
                  margin: "revert",
                },
              },
              layer: "typography",
            },
          },
        },
      },
      undefined,
      {
        layers: ["reset", "general", "typography"],
      },
    );

    styles();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assert(text.startsWith("@layer reset, general, typography;"));
    assertMatch(
      text,
      /@layer typography\{\.ink_[a-z0-9]+ h1, \.ink_[a-z0-9]+ h2\{margin:revert\}\}/,
    );
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime injects themes root vars and scoped theme rules", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink({
      themes: {
        default: new Theme({
          headerBG: "black",
        }),
        dark: new Theme({
          headerBG: "white",
        }),
      },
      base: {
        header: {
          backgroundColor: tVar.headerBG,
        },
      },
    });

    styles();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assert(text.includes(":root{--header-bg:black}"));
    assert(text.includes("@scope (.dark){:scope{--header-bg:white}}"));
    assertMatch(text, /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\)\}/);
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime injects themes root vars and prefers-color-scheme rules", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = ink(
      {
        themes: {
          default: new Theme({
            headerBG: "black",
          }),
          dark: new Theme({
            headerBG: "white",
          }),
        },
        base: {
          header: {
            backgroundColor: tVar.headerBG,
          },
        },
      },
      undefined,
      { themeMode: "color-scheme" },
    );

    styles();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assert(text.includes(":root{--header-bg:black}"));
    assert(
      text.includes(
        "@media (prefers-color-scheme: dark){:root{--header-bg:white}}",
      ),
    );
    assertMatch(text, /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\)\}/);
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime reinjects deduped rules when document instance changes", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };
  type FakeDocument = {
    getElementById: (id: string) => FakeStyleTag | null;
    createElement: (_tag: "style") => FakeStyleTag;
    createTextNode: (text: string) => string;
    head: { appendChild: (node: unknown) => void };
  };

  function createFakeDocument(tags: Map<string, FakeStyleTag>): FakeDocument {
    return {
      getElementById(id: string) {
        return tags.get(id) ?? null;
      },
      createElement(_tag: "style"): FakeStyleTag {
        return {
          id: "",
          textContent: "",
          appendChild(node: unknown) {
            this.textContent += String(node);
          },
        };
      },
      createTextNode(text: string) {
        return text;
      },
      head: {
        appendChild(node: unknown) {
          const tag = node as FakeStyleTag;
          tags.set(tag.id, tag);
        },
      },
    };
  }

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;

  try {
    const firstTags = new Map<string, FakeStyleTag>();
    globals.document = createFakeDocument(firstTags);
    ink({ base: { header: { color: "red" } } })();
    const firstCss = firstTags.get("__ink_runtime_styles")?.textContent ?? "";
    assert(firstCss.includes("color:red"));

    const secondTags = new Map<string, FakeStyleTag>();
    globals.document = createFakeDocument(secondTags);
    ink({ base: { header: { color: "red" } } })();
    const secondCss = secondTags.get("__ink_runtime_styles")?.textContent ?? "";
    assert(secondCss.includes("color:red"));
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("parser requires unquoted variant keys to be declared in base", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      myButton: {}
    },
    variant: {
      size: {
        sm: { label: { fontSize: "0.8rem" } }
      }
    }
  }`);

  assertEquals(parsed, null);
});

Deno.test("parser accepts variant keys declared as empty base rules", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      myButton: {},
      label: {}
    },
    variant: {
      size: {
        sm: { label: { fontSize: "0.8rem" } }
      }
    }
  }`);

  assert(parsed !== null);
  assertEquals(
    styleDeclarationOf(parsed.variant?.size?.sm?.label).fontSize,
    "0.8rem",
  );
});

Deno.test("parser routes quoted variant keys into variantGlobal", () => {
  const parsed = parseInkCallArguments(`{
    variant: {
      theme: {
        dark: {
          ":global(html)": { colorScheme: "dark" }
        }
      }
    },
    defaults: {
      theme: "dark"
    }
  }`);

  assert(parsed !== null);
  assertEquals(parsed.variant, undefined);
  assertEquals(
    parsed.variantGlobal?.theme?.dark?.[":global(html)"]?.colorScheme,
    "dark",
  );
  assertEquals(parsed.defaults, { theme: "dark" });
});

Deno.test("injects virtual stylesheet import in svelte files that only import ink styles", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);

  const source =
    `<script lang="ts">\nimport { styles } from "./styles.ts";\n</script>\n\n<div class={styles().card()}>hi</div>`;

  const transformed = transform(source, "/app/src/routes/+page.svelte");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(
    code.includes('<script lang="ts">\nimport "virtual:ink/styles.css";'),
  );
});

Deno.test("extracts css from ts module and serves it through the virtual stylesheet", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });`;
  const transformed = transform(moduleCode, "/app/src/lib/styles.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(loaded as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("extracts css from bare identifier declaration values in ink() calls", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({ base: { card: { fontSize: revert, borderStyle: solid } } });`;
  const transformed = transform(moduleCode, "/app/src/lib/bare-identifiers.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes(`"fontSize":"revert"`));
  assert(code.includes(`"borderStyle":"solid"`));

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(
    loaded as string,
    /\.ink_[a-z0-9]+\{font-size:revert;border-style:solid\}/,
  );
});

Deno.test("extracts css from scoped package imports in ts modules", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });`;
  const transformed = transform(moduleCode, "/app/src/lib/scoped-styles.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(loaded as string, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("extracts merged declaration arrays at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    myButton: [\n` +
    `      { fontSize: "1.25rem", padding: "1rem" },\n` +
    `      { background: "black", color: "white", padding: "0.5rem" },\n` +
    `    ]\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/array-styles.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{font-size:1\.25rem;padding:0\.5rem;background:black;color:white\}/,
  );
});

Deno.test("extracts space-delimited property arrays at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    pageWrapper: {\n` +
    `      display: "grid",\n` +
    `      gridTemplateRows: ["auto", "1fr", "auto"],\n` +
    `    }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/list-props.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{display:grid;grid-template-rows:auto 1fr auto\}/,
  );
});

Deno.test("extracts comma-delimited property arrays at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    textEl: {\n` +
    `      fontFamily: ["system-ui", "sans-serif"],\n` +
    `      transition: ["opacity 0.2s", "color 0.3s"],\n` +
    `    }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/comma-props.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{font-family:system-ui, sans-serif;transition:opacity 0\.2s, color 0\.3s\}/,
  );
});

Deno.test("extracts tokenized transition arrays as single shorthands at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    textEl: {\n` +
    `      transition: ["text-decoration-color", "0.2s", "ease-in-out"],\n` +
    `    }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/transition-token-props.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{transition:text-decoration-color 0\.2s ease-in-out\}/,
  );
});

Deno.test("extracts @apply merge lists at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const baseColors = { backgroundColor: "#4f4f4f", color: "black" };\n` +
    `const singleColumn = { gridTemplateRows: ["auto", "1fr", "auto"] };\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    pageWrapper: {\n` +
    `      display: "grid",\n` +
    `      "@apply": [baseColors, singleColumn],\n` +
    `      color: "#00aaff",\n` +
    `    }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/apply.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{display:grid;background-color:#4f4f4f;color:#00aaff;grid-template-rows:auto 1fr auto\}/,
  );
});

Deno.test("extracts layered @apply rule objects at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const prose = {\n` +
    `  "h1, h2": {\n` +
    `    margin: "revert",\n` +
    `    fontWeight: "revert",\n` +
    `  },\n` +
    `};\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    contentWrapper: {\n` +
    `      "@apply": [\n` +
    `        { marginInline: "auto" },\n` +
    `        { rules: prose, layer: "typography" },\n` +
    `      ],\n` +
    `      color: "black",\n` +
    `    },\n` +
    `  },\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/layered-apply.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{margin-inline:auto;color:black\}/,
  );
  assertMatch(
    css,
    /@layer typography\{\.ink_[a-z0-9]+ h1, \.ink_[a-z0-9]+ h2\{margin:revert;font-weight:revert\}\}/,
  );
});

Deno.test("extracts tw() class markers at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink, { tw } from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    nav: {\n` +
    `      "@apply": tw(["px-2", "px-4", "font-mono"]),\n` +
    `      color: "white",\n` +
    `    },\n` +
    `    navLink: tw(["underline-offset-2", "underline-offset-6", "hover:underline"]),\n` +
    `  },\n` +
    `  variant: {\n` +
    `    size: {\n` +
    `      lg: {\n` +
    `        nav: tw(["text-sm", "text-lg"]),\n` +
    `      },\n` +
    `    },\n` +
    `  },\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/tailwind-apply.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("tw("));
  assert(code.includes("underline-offset-6"));
  assert(code.includes("text-lg"));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{color:white\}/);
  assert(!css.includes("underline-offset"));
  assert(!css.includes("text-lg"));
});

Deno.test("injects tailwind merge helper for transformed tw() variants in svelte", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const source =
    `<script lang="ts">\nimport ink, { tw } from "@kraken/ink";\n` +
    `const componentStyles = new ink();\n` +
    `componentStyles.base = {\n` +
    `  content: {\n` +
    `    width: "min(100%, var(--page-width))",\n` +
    `    marginInline: "auto",\n` +
    `    "@apply": tw("lg:rounded-lg p-4 xs:text-justify"),\n` +
    `  },\n` +
    `};\n` +
    `componentStyles.variant = {\n` +
    `  prose: {\n` +
    `    true: {\n` +
    `      content: tw("prose"),\n` +
    `    },\n` +
    `  },\n` +
    `};\n` +
    `let { prose } = $props();\n` +
    `const { content } = componentStyles();\n` +
    `</script>\n\n<main class={content({ prose })}></main>`;
  const transformed = transform(source, "/app/src/lib/Content.svelte");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes('import "virtual:ink/styles.css";'));
  assert(code.includes('import "virtual:ink/tailwind-merge";'));
  assert(code.includes('"content":"prose"'));

  const helper = load(TAILWIND_RUNTIME_VIRTUAL_ID);
  assertEquals(typeof helper, "string");
  assert((helper as string).includes('from "tailwind-merge";'));
  assert((helper as string).includes("setTailwindMerge(twMerge);"));
});

Deno.test("extracts nested hover @apply tw() class markers at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink, { tw } from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    navLink: {\n` +
    `      hover: {\n` +
    `        "@apply": tw("underline underline-offset-2 underline-offset-6"),\n` +
    `      },\n` +
    `    },\n` +
    `  },\n` +
    `});`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/tailwind-nested-hover.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes("hover:underline"));
  assert(code.includes("hover:underline-offset-6"));
  assert(!code.includes("tw("));

  const css = load(VIRTUAL_ID) as string;
  assert(!css.includes("underline-offset"));
});

Deno.test("extracts @import stylesheet imports with relative paths", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/styles`, { recursive: true });
    Deno.writeTextFileSync(`${root}/src/styles/reset.css`, "/* reset */\n");

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  global: {\n` +
      `    "@import": ["./styles/reset.css"],\n` +
      `  },\n` +
      `  base: { page: { display: "grid" } },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/styles/reset.css";'));
    assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts Fontsource fonts from ink config", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink, { font } from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  fonts: [{ name: "Bungee", varName: "display" }],\n` +
      `  base: {\n` +
      `    header: { fontFamily: font.display },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "@fontsource/bungee";'));
    assert(css.includes(":root{--font-display:Bungee, system-ui}"));
    assertMatch(css, /\.ink_[a-z0-9]+\{font-family:var\(--font-display\)\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts @import stylesheet imports with aliased paths", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib/styles`, { recursive: true });
    Deno.writeTextFileSync(`${root}/src/lib/styles/reset.css`, "/* reset */\n");

    configResolved({
      root,
      resolve: {
        alias: [
          {
            find: "@styles",
            replacement: `${root}/src/lib/styles`,
          },
        ],
      },
    });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  global: {\n` +
      `    "@import": ["@styles/reset.css", "$lib/styles/reset.css"],\n` +
      `  },\n` +
      `  base: { page: { display: "grid" } },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/lib/styles/reset.css";'));
    assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts @import from svelte ink() into virtual global stylesheet", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib/styles`, { recursive: true });
    Deno.writeTextFileSync(`${root}/src/lib/styles/reset.css`, "/* reset */\n");

    configResolved({ root, resolve: { alias: [] } });

    const source = `<script lang="ts">\n` +
      `import ink from "@kraken/ink";\n` +
      `const styles = ink({\n` +
      `  global: {\n` +
      `    "@import": ["$lib/styles/reset.css"],\n` +
      `  },\n` +
      `  base: {\n` +
      `    page: { display: "grid" },\n` +
      `  },\n` +
      `});\n` +
      `</script>\n\n` +
      `<main class={styles().page()}></main>`;

    const transformed = transform(source, `${root}/src/routes/+layout.svelte`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    const code = transformed.code as string;
    assert(code.includes('import "virtual:ink/styles.css";'));
    assert(!code.includes('@import "/src/lib/styles/reset.css";'));
    assertMatch(code, /:global\(\.ink_[a-z0-9]+\)\{display:grid\}/);

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/lib/styles/reset.css";'));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts imported image assets used in new ink() global rules", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib/assets`, { recursive: true });
    Deno.writeTextFileSync(`${root}/src/lib/assets/bg.png`, "png");

    configResolved({ root, resolve: { alias: [] } });

    const source = `<script lang="ts">\n` +
      `import ink from "@kraken/ink";\n` +
      `import bgImage from "$lib/assets/bg.png";\n` +
      `const styles = new ink();\n` +
      `styles.global = { body: { background: bgImage } };\n` +
      `styles.base = { page: { minHeight: "100vh" } };\n` +
      `</script>\n\n` +
      `<main class={styles().page()}></main>`;

    const transformed = transform(source, `${root}/src/routes/+page.svelte`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes("styles.global ="));
    assertMatch(
      code,
      /:global\(body\)\{background:url\("\/src\/lib\/assets\/bg\.png"\)\}/,
    );
    assertMatch(code, /:global\(\.ink_[a-z0-9]+\)\{min-height:100vh\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts imported rules passed as array to import()", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `const styles = new ink();\n` +
      `styles.import([\n` +
      `  { rules: { testRule: { color: "red" } }, layer: "test" },\n` +
      `  { "@import": ["./foo.css"] }\n` +
      `]);`;

    const transformed = transform(
      moduleCode,
      `${root}/src/lib/array-import.ts`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/lib/foo.css";'));
    assert(css.includes("@layer test{testRule{color:red}}"));
    assert(!css.includes("0 rules *"));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts layered imported rules that use tVar.eval from ink package imports", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/src/lib/general.ts`,
      `import { tVar } from "@kraken/ink";\n` +
        `export default {\n` +
        `  body: {\n` +
        `    background: tVar.eval("linear-gradient(147deg, {bgStart}, {bgEnd})"),\n` +
        `    fontFamily: ["system-ui", "sans-serif"],\n` +
        `  },\n` +
        `} as const;\n`,
    );

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import GeneralRules from "./general";\n` +
      `const styles = new ink();\n` +
      `styles.import([{ rules: GeneralRules, layer: "general" }]);`;

    const transformed = transform(
      moduleCode,
      `${root}/src/lib/layered-import.ts`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /@layer general\{body\{background:linear-gradient\(147deg, var\(--bg-start\), var\(--bg-end\)\);font-family:system-ui, sans-serif\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("new ink() resolves default-export barrel rules through directory aliases", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/lib/styles`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/src/lib/styles/settings.ts`,
      `export default {\n` +
        `  body: {\n` +
        `    backgroundColor: "white",\n` +
        `    color: "black",\n` +
        `  },\n` +
        `} as const;\n`,
    );
    Deno.writeTextFileSync(
      `${root}/src/lib/styles/index.ts`,
      `import Settings from "@styles/settings";\n` +
        `export default {\n` +
        `  Settings,\n` +
        `} as const;\n`,
    );

    configResolved({
      root,
      resolve: {
        alias: [
          {
            find: "@styles",
            replacement: `${root}/src/lib/styles`,
          },
        ],
      },
    });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import Styles from "@styles";\n` +
      `const styles = new ink();\n` +
      `styles.import([{ rules: Styles.Settings }]);\n`;

    const transformed = transform(
      moduleCode,
      `${root}/src/routes/+layout.svelte`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes('@import "use strict";'));
    assertMatch(code, /:global\(body\)\{background-color:white;color:black\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolution=static throws when ink() cannot be statically resolved", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "static",\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      width: window.innerWidth,\n` +
      `    },\n` +
      `  },\n` +
      `});`;

    assertThrows(
      () => transform(moduleCode, `${root}/src/app.ts`),
      Error,
      'resolution="static" could not statically resolve ink(...)',
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolution=static extracts root vars from ink() config", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "static",\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  root: [{ "--blue": "#00aaff" }],\n` +
      `  base: {\n` +
      `    headerText: {\n` +
      `      color: "var(--blue)",\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(code.includes('"global":true'));

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes(":root{--blue:#00aaff}"));
    assertMatch(css, /\.ink_[a-z0-9]+\{color:var\(--blue\)\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("astro defaults to static resolution when resolution is not explicitly configured", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/pages`, { recursive: true });

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `---\n` +
      `import ink from "@kraken/ink";\n` +
      `const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      width: window.innerWidth,\n` +
      `    },\n` +
      `  },\n` +
      `});\n` +
      `---\n\n` +
      `<main class={styles().pageWrapper()}></main>`;

    assertThrows(
      () => transform(moduleCode, `${root}/src/pages/index.astro`),
      Error,
      'resolution="static" could not statically resolve ink(...)',
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("astro defaults to static resolution for unresolved new ink() assignments", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src/pages`, { recursive: true });

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `---\n` +
      `import ink from "@kraken/ink";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  pageWrapper: {\n` +
      `    width: window.innerWidth,\n` +
      `  },\n` +
      `};\n` +
      `---\n\n` +
      `<main class={styles().pageWrapper()}></main>`;

    assertThrows(
      () => transform(moduleCode, `${root}/src/pages/new-ink.astro`),
      Error,
      'resolution="static" could not statically resolve config for styles',
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolution=static extracts root assignments from new ink()", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "static",\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `const styles = new ink();\n` +
      `styles.root = [{ "--blue": "#00aaff" }];\n` +
      `styles.base = { headerText: { color: "var(--blue)" } };\n`;
    const transformed = transform(moduleCode, `${root}/src/new-ink.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(code.includes('"global":true'));

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes(":root{--blue:#00aaff}"));
    assertMatch(css, /\.ink_[a-z0-9]+\{color:var\(--blue\)\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolution=dynamic disables static extraction", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "dynamic",\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      display: "grid",\n` +
      `    },\n` +
      `  },\n` +
      `});`;

    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    const code = transformed.code as string;
    assert(code.includes('undefined, {"resolution":"dynamic"}'));

    const css = load(VIRTUAL_ID) as string;
    assert(!/\.ink_[a-z0-9]+/.test(css));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolution modes are enforced in dev server mode", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      width: window.innerWidth,\n` +
      `    },\n` +
      `  },\n` +
      `});`;

    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "static",\n` +
        `};\n`,
    );

    const staticPlugin = inkVite();
    const staticConfigResolved = asHook(staticPlugin.configResolved);
    const staticConfigureServer = asHook(staticPlugin.configureServer);
    const staticTransform = asHook(staticPlugin.transform);

    staticConfigResolved({ root, resolve: { alias: [] } });
    staticConfigureServer({
      moduleGraph: {
        getModuleById: () => null,
        invalidateModule: () => undefined,
      },
    });
    assertThrows(
      () => staticTransform(moduleCode, `${root}/src/dev-static.ts`),
      Error,
      'resolution="static" could not statically resolve ink(...)',
    );

    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  resolution: "dynamic",\n` +
        `};\n`,
    );

    const dynamicPlugin = inkVite();
    const dynamicConfigResolved = asHook(dynamicPlugin.configResolved);
    const dynamicConfigureServer = asHook(dynamicPlugin.configureServer);
    const dynamicTransform = asHook(dynamicPlugin.transform);
    const dynamicLoad = asHook(dynamicPlugin.load);

    dynamicConfigResolved({ root, resolve: { alias: [] } });
    dynamicConfigureServer({
      moduleGraph: {
        getModuleById: () => null,
        invalidateModule: () => undefined,
      },
    });
    const transformed = dynamicTransform(
      moduleCode,
      `${root}/src/dev-dynamic.ts`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    assert(
      (transformed.code as string).includes(
        'undefined, {"resolution":"dynamic"}',
      ),
    );

    const css = dynamicLoad(VIRTUAL_ID) as string;
    assert(!/\.ink_[a-z0-9]+/.test(css));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("debug.logStatic only logs in dev server mode", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  debug: {\n` +
        `    logStatic: true,\n` +
        `  },\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({ base: { card: { display: "grid" } } });`;

    const originalConsoleLog = console.log;
    const devLogs: string[] = [];
    const buildLogs: string[] = [];

    try {
      console.log = (...args: unknown[]) => {
        devLogs.push(args.map((value) => String(value)).join(" "));
      };

      const devPlugin = inkVite();
      const devConfigResolved = asHook(devPlugin.configResolved);
      const devConfigureServer = asHook(devPlugin.configureServer);
      const devTransform = asHook(devPlugin.transform);

      devConfigResolved({ root, resolve: { alias: [] } });
      devConfigureServer({
        moduleGraph: {
          getModuleById: () => null,
          invalidateModule: () => undefined,
        },
      });
      const transformed = devTransform(moduleCode, `${root}/src/dev.ts`);
      assert(
        transformed && typeof transformed === "object" && "code" in transformed,
      );
      assert(
        (transformed.code as string).includes(
          '"debug":{"enabled":true,"logDynamic":false,"logStatic":true}',
        ),
      );
    } finally {
      console.log = originalConsoleLog;
    }

    try {
      console.log = (...args: unknown[]) => {
        buildLogs.push(args.map((value) => String(value)).join(" "));
      };

      const buildPlugin = inkVite();
      const buildConfigResolved = asHook(buildPlugin.configResolved);
      const buildTransform = asHook(buildPlugin.transform);

      buildConfigResolved({ root, resolve: { alias: [] } });
      const transformed = buildTransform(moduleCode, `${root}/src/build.ts`);
      assert(
        transformed && typeof transformed === "object" && "code" in transformed,
      );
      assert(!(transformed.code as string).includes('"debug":'));
    } finally {
      console.log = originalConsoleLog;
    }

    assert(devLogs.some((entry) => entry.includes("[ink][static]")));
    assertEquals(buildLogs.length, 0);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts utilities and breakpoint aliases", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `import "./src/global.css";\n` +
        `const baseColors = { backgroundColor: "#4f4f4f", color: "black" };\n` +
        `export default {\n` +
        `  breakpoints: { md: "48rem" },\n` +
        `  utilities: {\n` +
        `    cardBase: {\n` +
        `      "@apply": [baseColors],\n` +
        `      borderRadius: "8px",\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );
    Deno.writeTextFileSync(`${root}/src/global.css`, "/* global */\n");

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      "@apply": ["cardBase"],\n` +
      `      display: "grid",\n` +
      `      "@md": {\n` +
      `        gridTemplateColumns: "1fr 1fr",\n` +
      `      },\n` +
      `      "!@md": {\n` +
      `        gridTemplateColumns: "1fr",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/global.css";'));
    assertMatch(
      css,
      /\.u-card-base\{background-color:#4f4f4f;color:black;border-radius:8px\}/,
    );
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{background-color:#4f4f4f;color:black;border-radius:8px;display:grid\}/,
    );
    assertMatch(
      css,
      /@media \(width >= 48rem\)\{\.ink_[a-z0-9]+\{grid-template-columns:1fr 1fr\}\}/,
    );
    assertMatch(
      css,
      /@media \(width <= 48rem\)\{\.ink_[a-z0-9]+\{grid-template-columns:1fr\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts themes into the shared stylesheet", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  themes: {\n` +
        `    default: { headerBG: "black" },\n` +
        `    dark: { headerBG: "white" },\n` +
        `  },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink, { tVar } from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    header: {\n` +
      `      backgroundColor: tVar.headerBG,\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes(":root{--header-bg:black}"));
    assert(
      css.includes(
        "@media (prefers-color-scheme: dark){:root{--header-bg:white}}",
      ),
    );
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\)\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts Fontsource fonts into the shared stylesheet", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  fonts: [{ name: "Bungee", varName: "display" }],\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink, { font } from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    header: { fontFamily: font.display },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "@fontsource/bungee";'));
    assert(css.includes(":root{--font-display:Bungee, system-ui}"));
    assertMatch(css, /\.ink_[a-z0-9]+\{font-family:var\(--font-display\)\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts scope theme mode into the shared stylesheet", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  themeMode: "scope",\n` +
        `  themes: {\n` +
        `    default: { headerBG: "black" },\n` +
        `    dark: { headerBG: "white" },\n` +
        `  },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink, { tVar } from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    header: {\n` +
      `      backgroundColor: tVar.headerBG,\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes(":root{--header-bg:black}"));
    assert(css.includes("@scope (.dark){:scope{--header-bg:white}}"));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts defaultUnit for numeric style values", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  defaultUnit: "rem",\n` +
        `  utilities: {\n` +
        `    cardBase: {\n` +
        `      marginBlock: 1,\n` +
        `    },\n` +
        `  },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      "@apply": ["cardBase"],\n` +
      `      fontSize: 1,\n` +
      `      padding: 2,\n` +
      `      lineHeight: 1.2,\n` +
      `    },\n` +
      `  },\n` +
      `});`;

    const transformed = transform(
      moduleCode,
      `${root}/src/app-default-unit.ts`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    assert((transformed.code as string).includes('"defaultUnit":"rem"'));

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.u-card-base\{margin-block:1rem\}/);
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{margin-block:1rem;font-size:1rem;padding:2rem;line-height:1\.2\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts defaultUnit for numeric values mixed with tw() in new ink()", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  defaultUnit: "rem",\n` +
        `  resolution: "static",\n` +
        `} as const;\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink, { tw } from "@kraken/ink";\n` +
      `const componentStyles = new ink();\n` +
      `componentStyles.base = {\n` +
      `  header: {\n` +
      `    "@apply": tw("grid grid-cols-[auto_1fr] gap-4 m-4 border-4 rounded-lg"),\n` +
      `    alignItems: "center",\n` +
      `    margin: 1,\n` +
      `    padding: [0.25, 1],\n` +
      `  },\n` +
      `};`;

    const transformed = transform(
      moduleCode,
      `${root}/src/app-default-unit-tailwind.ts`,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    assert((transformed.code as string).includes('"defaultUnit":"rem"'));
    assertMatch(
      transformed.code as string,
      /"header":"ink_[a-z0-9]+ grid grid-cols-\[auto_1fr\] gap-4 m-4 border-4 rounded-lg"/,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{align-items:center;margin:1rem;padding:0\.25rem 1rem\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts layers and emits configured layer order", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  layers: [" reset ", "general", "typography", "general"],\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  global: {\n` +
      `    "@layer typography": {\n` +
      `      "h1": { margin: "revert" }\n` +
      `    }\n` +
      `  },\n` +
      `});`;

    const transformed = transform(moduleCode, `${root}/src/app-layers.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );
    assert(
      (transformed.code as string).includes(
        '"layers":["reset","general","typography"]',
      ),
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.startsWith("@layer reset, general, typography;"));
    assert(css.includes("@layer reset{}@layer general{}@layer typography{}"));
    assertMatch(css, /@layer typography\{h1\{margin:revert\}\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts breakpoint ranges with @(from,to) shorthand", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  breakpoints: {\n` +
        `    xs: "30rem",\n` +
        `    xl: "80rem",\n` +
        `  },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      display: "grid",\n` +
      `      "@(xs,xl)": {\n` +
      `        gridTemplateColumns: "1fr 1fr",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app-range.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /@media \(30rem < width < 80rem\)\{\.ink_[a-z0-9]+\{grid-template-columns:1fr 1fr\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts containers and supports @set/@container shorthand", () => {
  const root = Deno.makeTempDirSync();

  try {
    Deno.mkdirSync(`${root}/src`, { recursive: true });
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `export default {\n` +
        `  containers: {\n` +
        `    card: { type: "inline-size", rule: "width < 20rem" },\n` +
        `  },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    mainContainer: {\n` +
      `      "@set": "card",\n` +
      `    },\n` +
      `    card: {\n` +
      `      "@card": {\n` +
      `        backgroundColor: "blue",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/app-container.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{container-name:card;container-type:inline-size\}/,
    );
    assertMatch(
      css,
      /@container card \(width < 20rem\)\{\.ink_[a-z0-9]+\{background-color:blue\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts breakpoints from imported constants", () => {
  const root = Deno.makeTempDirSync();

  try {
    const stylesDir = `${root}/src/lib/styles`;
    Deno.mkdirSync(stylesDir, { recursive: true });
    Deno.writeTextFileSync(
      `${stylesDir}/tokens.ts`,
      `export const pageWidth = "60rem";\n`,
    );
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `import { pageWidth } from "./src/lib/styles/tokens";\n` +
        `export default {\n` +
        `  breakpoints: { sm: pageWidth },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({ root, resolve: { alias: [] } });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      textAlign: "left",\n` +
      `      "@sm": {\n` +
      `        textAlign: "justify",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /@media \(width >= 60rem\)\{\.ink_[a-z0-9]+\{text-align:justify\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts imports and breakpoints through Vite resolve.alias", () => {
  const root = Deno.makeTempDirSync();

  try {
    const themeDir = `${root}/src/theme`;
    Deno.mkdirSync(themeDir, { recursive: true });
    Deno.writeTextFileSync(
      `${themeDir}/layout.ts`,
      `export const pageWidth = "72rem";\n`,
    );
    Deno.writeTextFileSync(`${themeDir}/global.css`, "/* themed global */\n");
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `import "@theme/global.css";\n` +
        `import { pageWidth } from "@theme/layout";\n` +
        `export default {\n` +
        `  breakpoints: { sm: pageWidth },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({
      root,
      resolve: {
        alias: [
          {
            find: "@theme",
            replacement: `${root}/src/theme`,
          },
        ],
      },
    });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      textAlign: "left",\n` +
      `      "@sm": {\n` +
      `        textAlign: "justify",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes('@import "/src/theme/global.css";'));
    assertMatch(
      css,
      /@media \(width >= 72rem\)\{\.ink_[a-z0-9]+\{text-align:justify\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("loads ink.config.ts barrel imports through resolve.alias", () => {
  const root = Deno.makeTempDirSync();

  try {
    const themeDir = `${root}/src/theme`;
    Deno.mkdirSync(themeDir, { recursive: true });
    Deno.writeTextFileSync(
      `${themeDir}/layout.ts`,
      `export default {\n` +
        `  pageWidth: "72rem",\n` +
        `} as const;\n`,
    );
    Deno.writeTextFileSync(
      `${themeDir}/index.ts`,
      `import Layout from "@theme/layout";\n` +
        `export default {\n` +
        `  Layout,\n` +
        `} as const;\n`,
    );
    Deno.writeTextFileSync(
      `${root}/ink.config.ts`,
      `import Theme from "@theme";\n` +
        `export default {\n` +
        `  breakpoints: { sm: Theme.Layout.pageWidth },\n` +
        `};\n`,
    );

    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const load = asHook(plugin.load);
    const configResolved = asHook(plugin.configResolved);

    configResolved({
      root,
      resolve: {
        alias: [
          {
            find: "@theme",
            replacement: `${root}/src/theme`,
          },
        ],
      },
    });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    pageWrapper: {\n` +
      `      textAlign: "left",\n` +
      `      "@sm": {\n` +
      `        textAlign: "justify",\n` +
      `      },\n` +
      `    },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /@media \(width >= 72rem\)\{\.ink_[a-z0-9]+\{text-align:justify\}\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported style objects and precompiles them", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/styles.ts`,
      `export const commonColors = {\n` +
        `  background: "black",\n` +
        `  color: "white",\n` +
        `};\n` +
        `export const buttonStyles = {\n` +
        `  fontSize: "1.25rem",\n` +
        `  fontWeight: 600,\n` +
        `  padding: "1rem",\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { buttonStyles, commonColors } from "$lib/styles";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    myButton: [buttonStyles, commonColors]\n` +
      `  },\n` +
      `  variant: {\n` +
      `    size: {\n` +
      `      lg: { myButton: { fontSize: "2rem" } }\n` +
      `    }\n` +
      `  }\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{font-size:1\.25rem;font-weight:600;padding:1rem;background:black;color:white\}/,
    );
    assertMatch(css, /\.ink_[a-z0-9]+\{font-size:2rem\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported theme objects for themes", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/theme.ts`,
      `export default {\n` +
        `  light: {\n` +
        `    headerBG: "black",\n` +
        `  },\n` +
        `  dark: {\n` +
        `    headerBG: "white",\n` +
        `  },\n` +
        `};\n`,
    );

    const moduleCode = `import ink, { tVar } from "@kraken/ink";\n` +
      `import SiteTheme from "$lib/theme";\n` +
      `export const styles = ink({\n` +
      `  themes: {\n` +
      `    default: SiteTheme.light,\n` +
      `    dark: SiteTheme.dark,\n` +
      `  },\n` +
      `  base: {\n` +
      `    header: { backgroundColor: tVar.headerBG },\n` +
      `  },\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assert(css.includes(":root{--header-bg:black}"));
    assert(
      css.includes(
        "@media (prefers-color-scheme: dark){:root{--header-bg:white}}",
      ),
    );
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\)\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves namespace-imported style objects and precompiles them", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/styles.ts`,
      `export const darkBar = {\n` +
        `  backgroundColor: "oklch(from #00aaff 20% c h)",\n` +
        `  color: "white",\n` +
        `};\n` +
        `export const lightBar = {\n` +
        `  backgroundColor: "black",\n` +
        `  color: "white",\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import * as S from "$lib/styles";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    mainHeader: { display: "grid" }\n` +
      `  },\n` +
      `  variant: {\n` +
      `    theme: {\n` +
      `      dark: { mainHeader: [S.darkBar] },\n` +
      `      light: { mainHeader: [S.lightBar] }\n` +
      `    }\n` +
      `  }\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/Header.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{background-color:oklch\(from #00aaff 20% c h\);color:white\}/,
    );
    assertMatch(css, /\.ink_[a-z0-9]+\{background-color:black;color:white\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported constants through Vite resolve.alias", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const configResolved = asHook(plugin.configResolved);

  const root = Deno.makeTempDirSync();

  try {
    const themeDir = `${root}/src/themes`;
    Deno.mkdirSync(themeDir, { recursive: true });
    Deno.writeTextFileSync(
      `${themeDir}/colors.ts`,
      `export const light = {\n` +
        `  blue: "#00aaff",\n` +
        `};\n`,
    );

    configResolved({
      root,
      resolve: {
        alias: [
          {
            find: "@theme",
            replacement: `${root}/src/themes`,
          },
        ],
      },
    });

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { light } from "@theme/colors";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    myButton: {\n` +
      `      backgroundColor: light.blue,\n` +
      `      color: "white",\n` +
      `    }\n` +
      `  }\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.ink_[a-z0-9]+\{background-color:#00aaff;color:white\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported constants through tsconfig paths aliases", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const themeDir = `${root}/src/custom-theme`;
    Deno.mkdirSync(themeDir, { recursive: true });
    Deno.writeTextFileSync(
      `${themeDir}/colors.ts`,
      `export const light = {\n` +
        `  blue: "#00aaff",\n` +
        `};\n`,
    );
    Deno.writeTextFileSync(
      `${root}/tsconfig.json`,
      `{\n` +
        `  // comment to ensure JSONC parsing works\n` +
        `  "compilerOptions": {\n` +
        `    "baseUrl": ".",\n` +
        `    "paths": {\n` +
        `      "@theme/*": ["src/custom-theme/*",]\n` +
        `    },\n` +
        `  },\n` +
        `}\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { light } from "@theme/colors";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    myButton: {\n` +
      `      backgroundColor: light.blue,\n` +
      `      color: "white",\n` +
      `    }\n` +
      `  }\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.ink_[a-z0-9]+\{background-color:#00aaff;color:white\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves tsconfig paths aliases when extends chain does not define baseUrl", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const tsconfigDir = `${root}/node_modules/astro/tsconfigs`;
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(tsconfigDir, { recursive: true });
    Deno.mkdirSync(libDir, { recursive: true });

    Deno.writeTextFileSync(
      `${tsconfigDir}/base.json`,
      `{\n` +
        `  "compilerOptions": {\n` +
        `    "strict": true\n` +
        `  }\n` +
        `}\n`,
    );
    Deno.writeTextFileSync(
      `${tsconfigDir}/strict.json`,
      `{\n` +
        `  "extends": "./base.json",\n` +
        `  "compilerOptions": {\n` +
        `    "noUncheckedIndexedAccess": true\n` +
        `  }\n` +
        `}\n`,
    );
    Deno.writeTextFileSync(
      `${root}/tsconfig.json`,
      `{\n` +
        `  "extends": "astro/tsconfigs/strict",\n` +
        `  "compilerOptions": {\n` +
        `    "paths": {\n` +
        `      "@/*": ["./src/*"]\n` +
        `    }\n` +
        `  }\n` +
        `}\n`,
    );

    Deno.writeTextFileSync(
      `${libDir}/theme.ts`,
      `export const palette = {\n` +
        `  accent: "#00aaff",\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { palette } from "@/lib/theme";\n` +
      `export const styles = ink({\n` +
      `  base: {\n` +
      `    myButton: {\n` +
      `      backgroundColor: palette.accent,\n` +
      `      color: "white",\n` +
      `    }\n` +
      `  }\n` +
      `});`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.ink_[a-z0-9]+\{background-color:#00aaff;color:white\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported constants computed by static helper function calls", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/stylesheet.ts`,
      `const colorUtils = {\n` +
        `  oklch: (l: number, c: number, h: number) => \`oklch(\${l}% \${c} \${h})\`,\n` +
        `};\n` +
        `export const blue = {\n` +
        `  l300: colorUtils.oklch(70, 0.1679, 242.04),\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { blue } from "$lib/stylesheet";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  header: { borderBottom: "2px solid currentColor" },\n` +
      `};\n` +
      `styles.variant = {\n` +
      `  theme: {\n` +
      `    dark: { header: { borderBottomColor: blue.l300 } },\n` +
      `  },\n` +
      `};\n` +
      `styles.defaults = { theme: "dark" };\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.ink_[a-z0-9]+\{border-bottom:2px solid currentColor\}/);
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{border-bottom-color:oklch\(70% 0\.1679 242\.04\)\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("resolves imported constants computed by function declarations", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/stylesheet.ts`,
      `function oklch(l: number, c: number, h: number) {\n` +
        `  return \`oklch(\${l}% \${c} \${h})\`;\n` +
        `}\n` +
        `export const blue = {\n` +
        `  l300: oklch(70, 0.1679, 242.04),\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { blue } from "$lib/stylesheet";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  header: { borderBottom: "2px solid currentColor" },\n` +
      `};\n` +
      `styles.variant = {\n` +
      `  theme: {\n` +
      `    dark: { header: { borderBottomColor: blue.l300 } },\n` +
      `  },\n` +
      `};\n` +
      `styles.defaults = { theme: "dark" };\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /\.ink_[a-z0-9]+\{border-bottom:2px solid currentColor\}/);
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{border-bottom-color:oklch\(70% 0\.1679 242\.04\)\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("new ink() resolves imported default objects without null-cache poisoning", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/theme.ts`,
      `function createPalette(color: string) {\n` +
        `  return { base: color };\n` +
        `}\n` +
        `function fontRegular() {\n` +
        `  return { fontWeight: 400 };\n` +
        `}\n` +
        `const fonts = {\n` +
        `  regular: fontRegular,\n` +
        `};\n` +
        `const colors = {\n` +
        `  primary: createPalette("#00aaff"),\n` +
        `};\n` +
        `export default {\n` +
        `  font: fonts,\n` +
        `  color: colors,\n` +
        `};\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import theme from "$lib/theme";\n` +
      `const styles = new ink();\n` +
      `styles.global = {\n` +
      `  body: {\n` +
      `    "@apply": theme.font.regular(),\n` +
      `  },\n` +
      `};\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes("new ink()"));
    const css = load(VIRTUAL_ID) as string;
    assertMatch(css, /body\{font-weight:400\}/);
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("new ink() extracts styles mixing unquoted value tokens and function calls", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `function responsiveWidth(width: string) {\n` +
    `  return \`min(\${width}, 100%)\`;\n` +
    `}\n` +
    `const styles = new ink();\n` +
    `styles.base = {\n` +
    `  content: {\n` +
    `    width: responsiveWidth("60rem"),\n` +
    `    textAlign: center,\n` +
    `    color: red,\n` +
    `    marginInline: "auto",\n` +
    `  },\n` +
    `};\n`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/new-ink-mixed-unquoted.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));
  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{width:min\(60rem, 100%\);text-align:center;color:red;margin-inline:auto\}/,
  );
});

Deno.test("new ink() extracts styles computed by local function declarations", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `function responsiveWidth(width: string) {\n` +
    `  return \`min(\${width}, 100%)\`;\n` +
    `}\n` +
    `const styles = new ink();\n` +
    `styles.base = {\n` +
    `  content: {\n` +
    `    width: responsiveWidth("60rem"),\n` +
    `    marginInline: "auto",\n` +
    `  },\n` +
    `};\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink-local-fn.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));
  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{width:min\(60rem, 100%\);margin-inline:auto\}/,
  );
});

Deno.test("new ink() extracts styles computed by local const arrow functions", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const responsiveWidth = (width: string) => \`min(\${width}, 100%)\`;\n` +
    `const styles = new ink();\n` +
    `styles.base = {\n` +
    `  content: {\n` +
    `    width: responsiveWidth("60rem"),\n` +
    `    marginInline: "auto",\n` +
    `  },\n` +
    `};\n`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/new-ink-local-arrow.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));
  const css = load(VIRTUAL_ID) as string;
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{width:min\(60rem, 100%\);margin-inline:auto\}/,
  );
});

Deno.test("new ink() extracts styles computed by imported default const arrow functions", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/responsive.ts`,
      `const responsiveWidth = (width: string) => \`min(\${width}, 100%)\`;\n` +
        `export default responsiveWidth;\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import responsiveWidth from "$lib/responsive";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  content: {\n` +
      `    width: responsiveWidth("60rem"),\n` +
      `    marginInline: "auto",\n` +
      `  },\n` +
      `};\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes("new ink()"));
    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{width:min\(60rem, 100%\);margin-inline:auto\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("new ink() extracts styles computed by imported named const arrow functions", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/responsive.ts`,
      `export const responsiveWidth = (width: string) => \`min(\${width}, 100%)\`;\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { responsiveWidth } from "$lib/responsive";\n` +
      `const styles = new ink();\n` +
      `styles.base = {\n` +
      `  content: {\n` +
      `    width: responsiveWidth("60rem"),\n` +
      `    marginInline: "auto",\n` +
      `  },\n` +
      `};\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes("new ink()"));
    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{width:min\(60rem, 100%\);margin-inline:auto\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("extracts quoted nested selectors and nested @media/@container at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    mainNavigation: {\n` +
    `      fontSize: "1.25rem",\n` +
    `      "ul": {\n` +
    `        display: "flex",\n` +
    `        "@media (width < 20rem)": {\n` +
    `          "ul": { display: "grid" }\n` +
    `        },\n` +
    `        "@container nav (inline-size > 30rem)": {\n` +
    `          "a:hover": { textDecoration: "underline" }\n` +
    `        }\n` +
    `      }\n` +
    `    }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/nested.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  const css = loaded as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{font-size:1\.25rem\}/);
  assertMatch(css, /\.ink_[a-z0-9]+ ul\{display:flex\}/);
  assertMatch(
    css,
    /@media \(width < 20rem\)\{\.ink_[a-z0-9]+ ul ul\{display:grid\}\}/,
  );
  assertMatch(
    css,
    /@container nav \(inline-size > 30rem\)\{\.ink_[a-z0-9]+ ul a:hover\{text-decoration:underline\}\}/,
  );
});

Deno.test("does not trigger a websocket full-reload during transform", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const configureServer = asHook(plugin.configureServer);

  configureServer({
    moduleGraph: {
      getModuleById: () => ({}),
      invalidateModule: () => {},
    },
    ws: {
      send: (payload: { type?: string }) => {
        if (payload?.type === "full-reload") {
          throw new Error("unexpected full reload");
        }
      },
    },
  });

  const moduleCode =
    `import ink from "@kraken/ink";\nexport const styles = ink({ base: { card: { display: "grid" } } });`;
  const transformed = transform(moduleCode, "/app/src/lib/no-reload.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );
});

Deno.test("extracts cVar() CSS variable usage at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink, { cVar } from "@kraken/ink";\n` +
    `export const styles = ink({ base: { card: { backgroundColor: cVar("--background") } } });`;
  const transformed = transform(moduleCode, "/app/src/lib/vars.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(
    loaded as string,
    /\.ink_[a-z0-9]+\{background-color:var\(--background\)\}/,
  );
});

Deno.test("extracts cVar() numeric fallback with property-aware units", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink, { cVar } from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    card: { padding: cVar("--space", 8), fontWeight: cVar("--weight", 600) }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/vars-fallback.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  assertMatch(
    loaded as string,
    /\.ink_[a-z0-9]+\{padding:var\(--space, 8px\);font-weight:var\(--weight, 600\)\}/,
  );
});

Deno.test("extracts variant styles and compiles variant class maps", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    headerText: { display: "grid" },\n` +
    `    mainHeader: {},\n` +
    `  },\n` +
    `  variant: {\n` +
    `    theme: {\n` +
    `      red: { headerText: { backgroundColor: "red" } },\n` +
    `    },\n` +
    `  },\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/variants.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(code, /variant/);

  const loaded = load(VIRTUAL_ID);
  assertEquals(typeof loaded, "string");
  const css = loaded as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{background-color:red\}/);
});

Deno.test("extracts css when defaults are present in ink config", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  base: {\n` +
    `    myButton: { padding: "1rem" }\n` +
    `  },\n` +
    `  variant: {\n` +
    `    size: {\n` +
    `      sm: { myButton: { fontSize: "0.8rem" } },\n` +
    `      md: { myButton: { fontSize: "1rem" } }\n` +
    `    }\n` +
    `  },\n` +
    `  defaults: {\n` +
    `    size: "md"\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/default-variants.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(code, /defaults/);

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{padding:1rem\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{font-size:0\.8rem\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{font-size:1rem\}/);
});

Deno.test("runtime applies defaults to variant selection and allows overrides", () => {
  const styles = ink({
    base: {
      myButton: { padding: "1rem", fontSize: "1rem" },
    },
    variant: {
      size: {
        sm: { myButton: { fontSize: "0.8rem" } },
        md: { myButton: { fontSize: "1rem" } },
      },
    },
    defaults: {
      size: "md",
    },
  } as any);

  const withDefaults = styles().myButton();
  assertEquals(withDefaults, styles().myButton({}));
  assertEquals(withDefaults, styles().myButton({ size: "md" }));
  assert(withDefaults !== styles().myButton({ size: "sm" }));
});

Deno.test("runtime applies variant overrides for empty base declarations", () => {
  const styles = ink({
    base: {
      myButton: { padding: "1rem" },
      label: {},
    },
    variant: {
      size: {
        sm: { label: { fontSize: "0.8rem" } },
      },
    },
  } as any);

  assertEquals(styles().label.style(), "");
  assertEquals(styles().label.style({ size: "sm" }), "font-size:0.8rem");
  assertMatch(styles().label({ size: "sm" }), /^ink_[a-z0-9]+ ink_[a-z0-9]+$/);
});

Deno.test("runtime resolves boolean variant selections and false defaults", () => {
  const styles = ink({
    base: {
      content: { color: "black" },
    },
    variant: {
      prose: {
        true: { content: { fontWeight: 700 } },
        false: { content: { fontWeight: 400 } },
      },
    },
    defaults: {
      prose: false,
    },
  } as any);

  assertEquals(styles().content.style(), "color:black;font-weight:400");
  assertEquals(
    styles().content.style({ prose: true }),
    "color:black;font-weight:700",
  );
  assertEquals(
    styles().content.style({ prose: false }),
    "color:black;font-weight:400",
  );
});

Deno.test("runtime swaps selected variantGlobal rules in static mode", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = new (ink as any)(
      undefined,
      {
        base: { app: "ink_app" },
        variantGlobal: {
          theme: {
            dark: ["html{color-scheme:dark}"],
            light: ["html{color-scheme:light}"],
          },
        },
      },
      { resolution: "static" },
    );
    styles.base = { app: {} };
    styles.variantGlobal = {
      theme: {
        dark: { ":global(html)": { colorScheme: "dark" } },
        light: { ":global(html)": { colorScheme: "light" } },
      },
    };
    styles.defaults = { theme: "dark" };

    styles().app();
    const variantTag = Array.from(tags.values()).find((tag) =>
      tag.id.includes("variant_global")
    );
    assert(variantTag);
    assertEquals(variantTag.textContent, "html{color-scheme:dark}");

    styles.defaults = { theme: "light" };
    styles().app();
    assertEquals(variantTag.textContent, "html{color-scheme:light}");
  } finally {
    if (originalDocument !== undefined) {
      globals.document = originalDocument;
    } else {
      delete globals.document;
    }
  }
});

Deno.test("runtime applies boolean defaults to variantGlobal rules", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = new (ink as any)(
      undefined,
      {
        base: { app: "ink_app" },
        variantGlobal: {
          prose: {
            true: ["html{color-scheme:dark}"],
            false: ["html{color-scheme:light}"],
          },
        },
      },
      { resolution: "static" },
    );
    styles.base = { app: {} };
    styles.variantGlobal = {
      prose: {
        true: { ":global(html)": { colorScheme: "dark" } },
        false: { ":global(html)": { colorScheme: "light" } },
      },
    };
    styles.defaults = { prose: false };

    styles().app();
    const variantTag = Array.from(tags.values()).find((tag) =>
      tag.id.includes("variant_global")
    );
    assert(variantTag);
    assertEquals(variantTag.textContent, "html{color-scheme:light}");

    styles.defaults = { prose: true };
    styles().app();
    assertEquals(variantTag.textContent, "html{color-scheme:dark}");
  } finally {
    if (originalDocument !== undefined) {
      globals.document = originalDocument;
    } else {
      delete globals.document;
    }
  }
});

Deno.test("runtime style() respects defaultUnit", () => {
  const styles = ink(
    {
      base: {
        card: {
          fontSize: 1,
          marginBlock: 2,
          lineHeight: 1.25,
        },
      },
    } as any,
    undefined,
    { defaultUnit: "rem" },
  );

  assertEquals(
    styles().card.style(),
    "font-size:1rem;margin-block:2rem;line-height:1.25",
  );
});

Deno.test("new ink() runtime style() respects defaultUnit when mixed with tw()", () => {
  const styles = new (ink as any)(undefined, undefined, { defaultUnit: "rem" });
  styles.base = {
    header: {
      "@apply": tw("grid grid-cols-[auto_1fr] gap-4 m-4 border-4 rounded-lg"),
      alignItems: "center",
      margin: 1,
      padding: [0.25, 1],
    },
  };

  const headerClass = styles().header();
  assert(headerClass.includes("grid"));
  assert(headerClass.includes("m-4"));
  assertMatch(headerClass, /ink_[a-z0-9]+/);
  assertEquals(
    styles().header.style(),
    "align-items:center;margin:1rem;padding:0.25rem 1rem",
  );
});

Deno.test("runtime works without a document global", () => {
  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  if (originalDocument !== undefined) {
    delete globals.document;
  }

  try {
    const styles = ink({ base: { card: { display: "grid", gap: "1rem" } } });
    const className = styles().card();
    assertMatch(className, /^ink_[a-z0-9]+$/);
  } finally {
    if (originalDocument !== undefined) {
      globals.document = originalDocument;
    } else {
      delete globals.document;
    }
  }
});

Deno.test("extracts global section rules at build time", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `export const styles = ink({\n` +
    `  global: {\n` +
    `    "@layer reset": {\n` +
    `      "html": { scrollBehavior: "smooth" }\n` +
    `    }\n` +
    `  },\n` +
    `  base: {\n` +
    `    card: { display: "grid" }\n` +
    `  }\n` +
    `});`;
  const transformed = transform(moduleCode, "/app/src/lib/global.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /@layer reset\{html\{scroll-behavior:smooth\}\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
});

// --- new ink() builder tests ---

Deno.test("new ink() runtime with factory access pattern", () => {
  const styles = new (ink as any)();
  styles.base = {
    myButton: {
      backgroundColor: "black",
      color: "white",
      fontSize: "1.25rem",
    },
  };

  const className = styles().myButton();
  assertMatch(className, /^ink_[a-z0-9]+$/);
});

Deno.test("new ink() runtime with direct accessor access", () => {
  const styles = new (ink as any)();
  styles.base = {
    myButton: {
      backgroundColor: "black",
      color: "white",
    },
  };

  const viaFactory = styles().myButton();
  const viaDirect = styles.myButton();
  assertEquals(viaFactory, viaDirect);
});

Deno.test("new ink() runtime accepts root assignments", () => {
  type FakeStyleTag = {
    id: string;
    textContent: string;
    appendChild: (node: unknown) => void;
  };

  const globals = globalThis as Record<string, unknown>;
  const originalDocument = globals.document;
  const tags = new Map<string, FakeStyleTag>();
  const fakeDocument = {
    getElementById(id: string) {
      return tags.get(id) ?? null;
    },
    createElement(_tag: "style"): FakeStyleTag {
      return {
        id: "",
        textContent: "",
        appendChild(node: unknown) {
          this.textContent += String(node);
        },
      };
    },
    createTextNode(text: string) {
      return text;
    },
    head: {
      appendChild(node: unknown) {
        const tag = node as FakeStyleTag;
        tags.set(tag.id, tag);
      },
    },
  };

  globals.document = fakeDocument;

  try {
    const styles = new (ink as any)();
    styles.root = [
      {
        "--background": "#123",
      },
      {
        layer: "theme",
        vars: {
          "--accent": "gold",
        },
      },
    ];
    styles.base = {
      card: {
        display: "grid",
      },
    };

    styles().card();
    const styleTag = fakeDocument.getElementById("__ink_runtime_styles");
    const text = styleTag?.textContent ?? "";
    assert(text.includes(":root{--background:#123}"));
    assert(text.includes("@layer theme{:root{--accent:gold}}"));
    assertMatch(text, /\.ink_[a-z0-9]+\{display:grid\}/);
  } finally {
    globals.document = originalDocument;
  }
});

Deno.test("runtime accessors expose class() and style()", () => {
  const styles = new (ink as any)();
  styles.base = {
    myButton: {
      backgroundColor: "black",
      color: "white",
      hover: { color: "gold" },
    },
  };

  const accessor = styles().myButton;
  assertEquals(accessor.class(), accessor());
  assertEquals(accessor.style(), "background-color:black;color:white");
});

Deno.test("runtime accessors support tw() for mixed and direct Tailwind styles", () => {
  const styles = new (ink as any)();
  styles.base = {
    nav: {
      "@apply": tw(["px-2", "px-4", "font-mono"]),
      color: "white",
    },
    navLink: tw([
      "underline-offset-2",
      "underline-offset-6",
      "hover:underline",
    ]),
  };
  styles.variant = {
    size: {
      lg: {
        nav: tw(["text-sm", "text-lg"]),
      },
    },
  };

  const navClass = styles().nav();
  assert(navClass.includes("px-4"));
  assert(!navClass.includes("px-2"));
  assert(navClass.includes("font-mono"));
  assertMatch(navClass, /ink_[a-z0-9]+/);
  assertEquals(styles().nav.style(), "color:white");
  assertEquals(styles().navLink.style(), "");
  assertEquals(styles().navLink(), "underline-offset-6 hover:underline");

  const largeNavClass = styles().nav({ size: "lg" });
  assert(largeNavClass.includes("text-lg"));
  assert(!largeNavClass.includes("text-sm"));
});

Deno.test("runtime accessors support nested hover @apply tw() styles", () => {
  const styles = new (ink as any)();
  styles.base = {
    navLink: {
      hover: {
        "@apply": tw("underline underline-offset-2 underline-offset-6"),
      },
    },
  };

  assertEquals(
    styles().navLink(),
    "hover:underline hover:underline-offset-6",
  );
  assertEquals(styles().navLink.style(), "");
});

Deno.test("new ink() runtime with variants and defaults", () => {
  const styles = new (ink as any)();
  styles.base = {
    myButton: { padding: "1rem", fontSize: "1rem" },
  };
  styles.variant = {
    size: {
      sm: { myButton: { fontSize: "0.8rem" } },
      md: { myButton: { fontSize: "1rem" } },
    },
  };
  styles.defaults = { size: "md" };

  const withDefaults = styles().myButton();
  assertEquals(withDefaults, styles().myButton({}));
  assertEquals(withDefaults, styles().myButton({ size: "md" }));
  assert(withDefaults !== styles().myButton({ size: "sm" }));
  assertEquals(styles().myButton.style(), "padding:1rem;font-size:1rem");
  assertEquals(
    styles().myButton.style({ size: "sm" }),
    "padding:1rem;font-size:0.8rem",
  );
});

Deno.test("new ink({ simple: true }) runtime exposes shorthand accessor", () => {
  const content = new (ink as any)({ simple: true });
  content.base = {
    display: "grid",
    gap: "1rem",
  };
  content.variant = {
    prose: {
      true: {
        color: "rebeccapurple",
      },
    },
  };

  const baseClass = content();
  const proseClass = content({ prose: true });
  assertMatch(baseClass, /^ink_[a-z0-9]+$/);
  assert(baseClass !== proseClass);
  assertEquals(content.style(), "display:grid;gap:1rem");
  assertEquals(
    content.style({ prose: true }),
    "display:grid;gap:1rem;color:rebeccapurple",
  );
});

Deno.test("ink({ simple: true }) runtime returns shorthand accessor", () => {
  const content = (ink as any)({
    simple: true,
    base: {
      padding: "1rem",
    },
    variant: {
      tone: {
        loud: {
          color: "crimson",
        },
      },
    },
  });

  assertMatch(content(), /^ink_[a-z0-9]+$/);
  assert(content({ tone: "loud" }).includes("ink_"));
  assertEquals(content.style({ tone: "loud" }), "padding:1rem;color:crimson");
});

Deno.test("new ink() runtime supports addContainer with @set and @container shorthand", () => {
  const styles = new (ink as any)();
  styles.addContainer({
    name: "card",
    type: "inline-size",
    rule: "width < 20rem",
  });
  styles.base = {
    mainContainer: {
      "@set": "card",
    },
    card: {
      "@card": {
        backgroundColor: "blue",
      },
    },
  };

  const mainInline = styles().mainContainer.style();
  assert(mainInline.includes("container-name:card"));
  assert(mainInline.includes("container-type:inline-size"));
});

Deno.test("parser findNewInkDeclarations detects new ink() pattern", () => {
  const code = `import ink from "@kraken/ink";
const styles = new ink();
styles.base = { myButton: { backgroundColor: "black" } };
styles.root = [{ "--accent": "deepskyblue" }];
styles.global = { html: { margin: 0 } };`;

  const decls = findNewInkDeclarations(code);
  assertEquals(decls.length, 1);
  assertEquals(decls[0].varName, "styles");
  assertEquals(decls[0].assignments.length, 3);
  assertEquals(decls[0].assignments[0].property, "base");
  assertEquals(decls[0].assignments[1].property, "root");
  assertEquals(decls[0].assignments[2].property, "global");
});

Deno.test("parser findNewInkDeclarations detects simple builder options", () => {
  const code = `import ink from "@kraken/ink";
const content = new ink({ simple: true });
content.base = { display: "grid" };
content.variant = { prose: { true: { color: "red" } } };`;

  const decls = findNewInkDeclarations(code);
  assertEquals(decls.length, 1);
  assertEquals(decls[0].varName, "content");
  assertEquals(decls[0].simple, true);
  assertEquals(decls[0].optionsSource, "{ simple: true }");
  assertEquals(decls[0].assignments.length, 2);
});

Deno.test("parser accepts pre-normalized simple config fragments", () => {
  const partialBase = parseInkCallArguments(`{
    simple: true,
    base: {
      background: tVar.contentBackground,
      color: tVar.contentText,
      "@apply": tw("w-full lg:w-5xl mx-auto"),
      "@lg": { borderRadius: 0.5 },
      "@xs": { textAlign: "justify" }
    }
  }`);
  const partialVariant = parseInkCallArguments(`{
    simple: true,
    variant: {
      prose: {
        true: tw("prose max-w-none")
      }
    }
  }`);

  assert(partialBase !== null);
  assert(partialVariant !== null);

  const reparsed = parseInkConfig({
    simple: true,
    base: partialBase.base,
    variant: partialVariant.variant,
  });

  assert(reparsed !== null);
  assertEquals(
    styleDeclarationOf(reparsed.base.__ink_simple__).background,
    cVar("--content-background"),
  );
});

Deno.test("parser findNewInkDeclarations ignores commented assignments", () => {
  const code = `import ink from "@kraken/ink";
const styles = new ink();
styles.base = { myButton: { backgroundColor: "black" } };
// styles.global = { body: { background: tVar.eval("linear-gradient(147deg, {bgGradient1}, {bgGradient2})") } };
/* styles.root = [{ "--accent": "deepskyblue" }]; */`;

  const decls = findNewInkDeclarations(code);
  assertEquals(decls.length, 1);
  assertEquals(decls[0].assignments.length, 1);
  assertEquals(decls[0].assignments[0].property, "base");
});

Deno.test("vite extracts css from new ink() pattern", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { card: { display: "grid", gap: "1rem" } };\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
});

Deno.test("vite extracts Fontsource fonts from new ink() assignments", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink, { font } from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.fonts = [{ name: "Bungee", varName: "display" }];\n` +
    `styles.base = { header: { fontFamily: font.display } };\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink-fonts.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));
  assert(!code.includes("styles.fonts ="));

  const css = load(VIRTUAL_ID) as string;
  assert(css.includes('@import "@fontsource/bungee";'));
  assert(css.includes(":root{--font-display:Bungee, system-ui}"));
  assertMatch(css, /\.ink_[a-z0-9]+\{font-family:var\(--font-display\)\}/);
});

Deno.test("vite extracts css from new ink({ simple: true }) pattern", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const content = new ink({ simple: true });\n` +
    `content.base = { display: "grid", gap: "1rem" };\n` +
    `content.variant = { prose: { true: { color: "red" } } };\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink-simple.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink({ simple: true })"));
  assert(code.includes('"simple":true'));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid;gap:1rem\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{color:red\}/);
});

Deno.test(
  "vite does not double-transform ink() inside new ink({ simple: true }) in svelte",
  () => {
    const plugin = inkVite();
    const transform = asHook(plugin.transform);
    const source = `<script lang="ts">\n` +
      `import ink from "@kraken/ink";\n` +
      `let { children } = $props();\n` +
      `const wrapper = new ink({ simple: true });\n` +
      `wrapper.base = {\n` +
      `  display: "grid",\n` +
      `  gridTemplateRows: ["auto", "1fr", "auto"],\n` +
      `  "@page": { gap: 1 },\n` +
      `  minHeight: "100svh",\n` +
      `};\n` +
      `</script>\n` +
      `<div class={wrapper()}>{@render children?.()}</div>\n`;

    const transformed = transform(source, "/app/src/lib/Container.svelte");
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(!code.includes("new ink("));
    assert(!code.includes("ink({ simple: true })"));
    assertEquals(code.match(/\bink\(/g)?.length ?? 0, 1);
    assert(code.includes(`"simple":true`));
  },
);

Deno.test(
  "vite statically extracts simple builder configs with tVar references",
  () => {
    const root = Deno.makeTempDirSync();
    try {
      const plugin = inkVite();
      const configResolved = asHook(plugin.configResolved);
      const transform = asHook(plugin.transform);
      const load = asHook(plugin.load);
      const id = `${root}/src/layout.tsx`;

      Deno.mkdirSync(`${root}/src`, { recursive: true });
      Deno.writeTextFileSync(
        `${root}/ink.config.js`,
        `export default { resolution: "static" };\n`,
      );

      configResolved({ root, resolve: { alias: [] } });

      const moduleCode = `import ink, { tw, tVar } from "@kraken/ink";\n` +
        `export const Content = ({ children, prose }) => {\n` +
        `  const content = new ink({ simple: true });\n` +
        `  content.base = {\n` +
        `    background: tVar.contentBackground,\n` +
        `    color: tVar.contentText,\n` +
        `    "@apply": tw("w-full lg:w-5xl mx-auto"),\n` +
        `    "@lg": { borderRadius: 0.5 },\n` +
        `    "@xs": { textAlign: "justify" },\n` +
        `  };\n` +
        `  content.variant = {\n` +
        `    prose: {\n` +
        `      true: tw("prose max-w-none"),\n` +
        `    },\n` +
        `  };\n` +
        `  return <main className={content({ prose })}>{children ?? null}</main>;\n` +
        `};\n`;

      const transformed = transform(moduleCode, id);
      assert(
        transformed && typeof transformed === "object" && "code" in transformed,
      );

      const code = transformed.code as string;
      assert(!code.includes(`new ink({ simple: true })`));
      assert(code.includes(`"simple":true`));
      assert(code.includes(`"--content-background"`));
      assert(code.includes(`"--content-text"`));

      const css = load(VIRTUAL_ID) as string;
      assert(css.includes(`background:var(--content-background)`));
      assert(css.includes(`color:var(--content-text)`));
    } finally {
      Deno.removeSync(root, { recursive: true });
    }
  },
);

Deno.test("vite scopes new ink() builder transforms to each TSX component", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const Header = () => {\n` +
    `  const styles = new ink();\n` +
    `  styles.base = { header: { display: "grid" } };\n` +
    `  return <header className={styles.header()}>Title</header>;\n` +
    `};\n` +
    `const Content = () => {\n` +
    `  const styles = new ink();\n` +
    `  styles.base = { main: { width: "min(100%, 64rem)" } };\n` +
    `  return <main className={styles().main()}>Body</main>;\n` +
    `};\n`;
  const transformed = transform(moduleCode, "/app/src/lib/layout.tsx");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes("<header className={styles.header()}>Title</header>"));
  assert(code.includes("<main className={styles().main()}>Body</main>"));
  assert(code.includes('"header":{"kind":"ink-style"'));
  assert(code.includes('"main":{"kind":"ink-style"'));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{width:min\(100%, 64rem\)\}/);
});

Deno.test("vite extracts bare identifier declaration values from new ink() pattern", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { card: { fontSize: revert, borderStyle: solid } };\n`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/new-ink-bare-identifiers.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(code.includes(`"fontSize":"revert"`));
  assert(code.includes(`"borderStyle":"solid"`));

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{font-size:revert;border-style:solid\}/);
});

Deno.test("vite resolves @apply local const objects that use bare identifier values", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const utilityProse = {\n` +
    `  "p": { margin: revert },\n` +
    `  "h1": { fontWeight: revert },\n` +
    `};\n` +
    `const styles = new ink();\n` +
    `styles.base = {\n` +
    `  content: {\n` +
    `    "@apply": utilityProse,\n` +
    `    borderStyle: solid,\n` +
    `  },\n` +
    `};\n`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/new-ink-bare-identifiers-apply.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{border-style:solid\}/);
  assertMatch(css, /\.ink_[a-z0-9]+ p\{margin:revert\}/);
  assertMatch(css, /\.ink_[a-z0-9]+ h1\{font-weight:revert\}/);
});

Deno.test("vite extracts bare identifier declaration values with template literals", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const root = Deno.makeTempDirSync();

  try {
    const libDir = `${root}/src/lib`;
    Deno.mkdirSync(libDir, { recursive: true });
    Deno.writeTextFileSync(
      `${libDir}/theme.ts`,
      `export const theme = { width: "100%" };\n`,
    );

    const moduleCode = `import ink from "@kraken/ink";\n` +
      `import { theme } from "$lib/theme";\n` +
      `const styles = new ink();\n` +
      `styles.base = { card: { width: \`min(\${theme.width}, 60rem)\`, marginInline: auto } };\n`;
    const transformed = transform(moduleCode, `${root}/src/routes/+page.ts`);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const code = transformed.code as string;
    assert(code.includes(`"marginInline":"auto"`));

    const css = load(VIRTUAL_ID) as string;
    assertMatch(
      css,
      /\.ink_[a-z0-9]+\{width:min\(100%, 60rem\);margin-inline:auto\}/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite extracts new ink() with variants and global", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.global = { "@layer reset": { "html": { scrollBehavior: "smooth" } } };\n` +
    `styles.base = { card: { display: "grid" } };\n` +
    `styles.variant = { theme: { dark: { card: { backgroundColor: "black" } } } };\n` +
    `styles.defaults = { theme: "dark" };\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink-full.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /@layer reset\{html\{scroll-behavior:smooth\}\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
  assertMatch(css, /\.ink_[a-z0-9]+\{background-color:black\}/);
});

Deno.test("vite extracts new ink() root assignments", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.root = [{ "--background": "#111" }, { layer: "theme", vars: { "--accent": "deepskyblue" } }];\n` +
    `styles.base = { card: { display: "grid" } };\n`;
  const transformed = transform(moduleCode, "/app/src/lib/new-ink-root.ts");
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(code, /"root":\[/);

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:grid\}/);
});

Deno.test("vite extracts new ink() themes assignments defined with Theme instances", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const id = `${Deno.cwd()}/src/theme-imports.astro`;

  const moduleCode = `---\n` +
    `import ink, { Theme, cVar } from "./index.ts";\n` +
    `const styles = new ink();\n` +
    `styles.themes = {\n` +
    `  default: new Theme({ headerBG: "black" }),\n` +
    `  dark: new Theme({ headerBG: "white" }),\n` +
    `};\n` +
    `styles.base = { header: { backgroundColor: cVar("--header-bg") } };\n` +
    `---\n` +
    `<div class={styles().header()}>hi</div>`;
  const transformed = transform(moduleCode, id);
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("styles.themes ="));

  const css = load(VIRTUAL_ID) as string;
  assert(css.includes(":root{--header-bg:black}"));
  assert(
    css.includes(
      "@media (prefers-color-scheme: dark){:root{--header-bg:white}}",
    ),
  );
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\)\}/,
  );
});

Deno.test("vite extracts tVar references from new ink() builder assignments", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const id = `${Deno.cwd()}/src/theme-builder-tVar.astro`;

  const moduleCode = `---\n` +
    `import ink, { Theme, tVar } from "./index.ts";\n` +
    `const styles = new ink();\n` +
    `styles.themes = {\n` +
    `  default: new Theme({ headerBG: "black", headerFG: "white" }),\n` +
    `  dark: new Theme({ headerBG: "white", headerFG: "black" }),\n` +
    `};\n` +
    `styles.base = {\n` +
    `  header: {\n` +
    `    backgroundColor: tVar.headerBG,\n` +
    `    color: tVar.headerFG,\n` +
    `  },\n` +
    `};\n` +
    `---\n` +
    `<div class={styles().header()}>hi</div>`;
  const transformed = transform(moduleCode, id);
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assert(!code.includes("new ink()"));

  const css = load(VIRTUAL_ID) as string;
  assert(css.includes(":root{--header-bg:black;--header-fg:white}"));
  assert(
    css.includes(
      "@media (prefers-color-scheme: dark){:root{--header-bg:white;--header-fg:black}}",
    ),
  );
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{background-color:var\(--header-bg\);color:var\(--header-fg\)\}/,
  );
});

Deno.test("vite extracts tVar.eval() theme templates from new ink() builder assignments", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);
  const id = `${Deno.cwd()}/src/theme-builder-tVar-eval.astro`;

  const moduleCode = `---\n` +
    `import ink, { Theme, tVar } from "./index.ts";\n` +
    `const styles = new ink();\n` +
    `styles.themes = {\n` +
    `  default: new Theme({ bgGradient1: "#00aaff", bgGradient2: "#fff6a3" }),\n` +
    `  dark: new Theme({ bgGradient1: "#001018", bgGradient2: "#00334d" }),\n` +
    `};\n` +
    `styles.base = {\n` +
    `  hero: {\n` +
    `    backgroundImage: tVar.eval("linear-gradient(147deg, {bgGradient1}, {bgGradient2})"),\n` +
    `  },\n` +
    `};\n` +
    `---\n` +
    `<div class={styles().hero()}>hi</div>`;
  const transformed = transform(moduleCode, id);
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const css = load(VIRTUAL_ID) as string;
  assert(css.includes(":root{--bg-gradient1:#00aaff;--bg-gradient2:#fff6a3}"));
  assert(
    css.includes(
      "@media (prefers-color-scheme: dark){:root{--bg-gradient1:#001018;--bg-gradient2:#00334d}}",
    ),
  );
  assertMatch(
    css,
    /\.ink_[a-z0-9]+\{background-image:linear-gradient\(147deg, var\(--bg-gradient1\), var\(--bg-gradient2\)\)\}/,
  );
});

Deno.test("vite compiles quoted variant selectors into runtime-managed variantGlobal rules", () => {
  const plugin = inkVite();
  const transform = asHook(plugin.transform);
  const load = asHook(plugin.load);

  const moduleCode = `import ink from "@kraken/ink";\n` +
    `const styles = new ink();\n` +
    `styles.base = { app: { display: "block" } };\n` +
    `styles.variant = {\n` +
    `  theme: {\n` +
    `    dark: { ":global(html)": { colorScheme: "dark" } },\n` +
    `    light: { ":global(html)": { colorScheme: "light" } }\n` +
    `  }\n` +
    `};\n` +
    `styles.defaults = { theme: "dark" };\n`;
  const transformed = transform(
    moduleCode,
    "/app/src/lib/new-ink-variant-global.ts",
  );
  assert(
    transformed && typeof transformed === "object" && "code" in transformed,
  );

  const code = transformed.code as string;
  assertMatch(code, /variantGlobal/);
  assertMatch(code, /html\{color-scheme:dark\}/);
  assertMatch(code, /html\{color-scheme:light\}/);

  const css = load(VIRTUAL_ID) as string;
  assertMatch(css, /\.ink_[a-z0-9]+\{display:block\}/);
  assert(!css.includes("color-scheme:dark"));
  assert(!css.includes("color-scheme:light"));
});

Deno.test("vite watches statically imported theme modules used by new ink()", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const transform = asHook(plugin.transform);
    const themesId = `${root}/src/lib/themes.ts`;
    const pageId = `${root}/src/routes/+page.svelte`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.mkdirSync(`${root}/src/routes`, { recursive: true });
    Deno.writeTextFileSync(
      themesId,
      `import { Theme } from "@kraken/ink";\n` +
        `const light = new Theme({ bg: "white", fg: "black" });\n` +
        `const dark = new Theme({ bg: "black", fg: "white" });\n` +
        `export default { light, dark } as const;\n`,
    );

    const source = `<script lang="ts">\n` +
      `import ink, { tVar } from "@kraken/ink";\n` +
      `import Themes from "../lib/themes.ts";\n` +
      `const styles = new ink();\n` +
      `styles.themes = { default: Themes.light, dark: Themes.dark };\n` +
      `styles.base = { header: { backgroundColor: tVar.bg, color: tVar.fg } };\n` +
      `</script>\n` +
      `<header class={styles().header()}>hi</header>`;

    configResolved({ root, resolve: { alias: [] } });

    const watched: string[] = [];
    const transformed = transform.call(
      {
        addWatchFile: (id: string) => watched.push(id),
      },
      source,
      pageId,
    );
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    assert(watched.includes(themesId));
    assert((transformed.code as string).includes("--bg:black"));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite extracts font() helper values from imported theme modules", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const transform = asHook(plugin.transform);
    const themesId = `${root}/src/lib/themes.ts`;
    const pageId = `${root}/src/routes/+page.svelte`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.mkdirSync(`${root}/src/routes`, { recursive: true });
    Deno.writeTextFileSync(
      themesId,
      `import { Theme, font } from "@kraken/ink";\n` +
        `const light = new Theme({\n` +
        `  fontDisplay: font(["Inter Variable", "system-ui", "sans-serif"])\n` +
        `});\n` +
        `export default { light } as const;\n`,
    );

    const source = `<script lang="ts">\n` +
      `import ink, { tVar } from "@kraken/ink";\n` +
      `import Themes from "../lib/themes.ts";\n` +
      `const styles = new ink();\n` +
      `styles.themes = { default: Themes.light };\n` +
      `styles.base = { header: { fontFamily: tVar.fontDisplay } };\n` +
      `</script>\n` +
      `<header class={styles().header()}>hi</header>`;

    configResolved({ root, resolve: { alias: [] } });

    const transformed = transform(source, pageId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    assertMatch(
      transformed.code as string,
      /--font-display:"Inter Variable", system-ui, sans-serif/,
    );
    assertMatch(
      transformed.code as string,
      /font-family:var\(--font-display\)/,
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite invalidates style owner modules when imported theme files change", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const configureServer = asHook(plugin.configureServer);
    const transform = asHook(plugin.transform);
    const handleHotUpdate = asHook(plugin.handleHotUpdate);
    const themesId = `${root}/src/lib/themes.ts`;
    const pageId = `${root}/src/routes/+page.svelte`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.mkdirSync(`${root}/src/routes`, { recursive: true });
    Deno.writeTextFileSync(
      themesId,
      `import { Theme } from "@kraken/ink";\n` +
        `const light = new Theme({ bg: "white", fg: "black" });\n` +
        `const dark = new Theme({ bg: "black", fg: "white" });\n` +
        `export default { light, dark } as const;\n`,
    );

    const source = `<script lang="ts">\n` +
      `import ink, { tVar } from "@kraken/ink";\n` +
      `import Themes from "../lib/themes.ts";\n` +
      `const styles = new ink();\n` +
      `styles.themes = { default: Themes.light, dark: Themes.dark };\n` +
      `styles.base = { header: { backgroundColor: tVar.bg, color: tVar.fg } };\n` +
      `</script>\n` +
      `<header class={styles().header()}>hi</header>`;

    const invalidated: string[] = [];
    configResolved({ root, resolve: { alias: [] } });
    configureServer({
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        invalidateModule: (module: { id: string }) => {
          invalidated.push(module.id);
        },
      },
    });

    const transformed = transform(source, pageId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    handleHotUpdate({ file: themesId });

    assert(invalidated.includes(pageId));
    assert(invalidated.includes(VIRTUAL_ID));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite hot updates return virtual CSS modules for managed style files", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const configureServer = asHook(plugin.configureServer);
    const transform = asHook(plugin.transform);
    const handleHotUpdate = asHook(plugin.handleHotUpdate);
    const stylesId = `${root}/src/lib/styles.ts`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    const source = `import ink from "@kraken/ink";\n` +
      `const styles = new ink();\n` +
      `styles.base = { wrapper: { display: "grid", gap: "1rem" } };\n` +
      `export default styles;\n`;

    const stylesModule = { id: stylesId };
    const globalCssModule = { id: VIRTUAL_ID };
    const scopedCssModule = { id: scopedVirtualId(stylesId) };
    const invalidated: string[] = [];

    configResolved({ root, resolve: { alias: [] } });
    configureServer({
      moduleGraph: {
        getModuleById: (id: string) => {
          if (id === stylesId) return stylesModule;
          if (id === VIRTUAL_ID) return globalCssModule;
          if (id === scopedVirtualId(stylesId)) return scopedCssModule;
          return null;
        },
        getModulesByFile: (file: string) =>
          file === stylesId ? new Set([stylesModule]) : undefined,
        invalidateModule: (module: { id: string }) => {
          invalidated.push(module.id);
        },
      },
    });

    const transformed = transform(source, stylesId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const affected = handleHotUpdate({ file: stylesId });
    assert(Array.isArray(affected));

    const affectedIds = (affected as Array<{ id: string }>).map((module) =>
      module.id
    );
    assert(affectedIds.includes(stylesId));
    assert(affectedIds.includes(VIRTUAL_ID));
    assert(affectedIds.includes(scopedVirtualId(stylesId)));
    assert(invalidated.includes(VIRTUAL_ID));
    assert(invalidated.includes(scopedVirtualId(stylesId)));
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite hot updates invalidate managed modules with timestamped HMR invalidation", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const configureServer = asHook(plugin.configureServer);
    const transform = asHook(plugin.transform);
    const handleHotUpdate = asHook(plugin.handleHotUpdate);
    const stylesId = `${root}/src/lib/styles.ts`;
    const timestamp = 1234567890;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.writeTextFileSync(
      stylesId,
      `import ink from "@kraken/ink";\n` +
        `const styles = new ink();\n` +
        `styles.base = { wrapper: { display: "grid", gap: "1rem" } };\n` +
        `export default styles;\n`,
    );

    const invalidationCalls: unknown[][] = [];

    configResolved({ root, resolve: { alias: [] } });
    configureServer({
      moduleGraph: {
        getModuleById: (id: string) => ({ id }),
        getModulesByFile: (file: string) =>
          file === stylesId ? new Set([{ id: stylesId }]) : undefined,
        invalidateModule: (...args: unknown[]) => {
          invalidationCalls.push(args);
        },
      },
    });

    const transformed = transform(Deno.readTextFileSync(stylesId), stylesId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const priorInvalidationCount = invalidationCalls.length;
    handleHotUpdate({ file: stylesId, timestamp });

    const hotInvalidations = invalidationCalls.slice(priorInvalidationCount);
    assert(hotInvalidations.length > 0);
    for (const [, , callTimestamp, isHmr] of hotInvalidations) {
      assertEquals(callTimestamp, timestamp);
      assertEquals(isHmr, true);
    }
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("vite hot updates resolve owner modules through moduleGraph.getModulesByFile", () => {
  const root = Deno.makeTempDirSync();
  try {
    const plugin = inkVite();
    const configResolved = asHook(plugin.configResolved);
    const configureServer = asHook(plugin.configureServer);
    const transform = asHook(plugin.transform);
    const handleHotUpdate = asHook(plugin.handleHotUpdate);
    const themesId = `${root}/src/lib/themes.ts`;
    const pageId = `${root}/src/routes/+layout.svelte`;

    Deno.mkdirSync(`${root}/src/lib`, { recursive: true });
    Deno.mkdirSync(`${root}/src/routes`, { recursive: true });
    Deno.writeTextFileSync(
      themesId,
      `import { Theme } from "@kraken/ink";\n` +
        `const light = new Theme({ bg: "white", fg: "black" });\n` +
        `const dark = new Theme({ bg: "black", fg: "white" });\n` +
        `export default { light, dark } as const;\n`,
    );

    const source = `<script lang="ts">\n` +
      `import ink from "@kraken/ink";\n` +
      `import Themes from "../lib/themes.ts";\n` +
      `const styles = new ink();\n` +
      `styles.themes = { default: Themes.light, dark: Themes.dark };\n` +
      `</script>\n` +
      `<div></div>`;

    const scriptModule = { id: `${pageId}?svelte&type=script&lang.ts` };
    const mainModule = { id: pageId };
    const invalidated: string[] = [];

    configResolved({ root, resolve: { alias: [] } });
    configureServer({
      moduleGraph: {
        getModuleById: () => null,
        getModulesByFile: (file: string) =>
          file === pageId ? new Set([mainModule, scriptModule]) : undefined,
        invalidateModule: (module: { id: string }) => {
          invalidated.push(module.id);
        },
      },
    });

    const transformed = transform(source, pageId);
    assert(
      transformed && typeof transformed === "object" && "code" in transformed,
    );

    const affected = handleHotUpdate({ file: themesId });

    assert(Array.isArray(affected));
    assert(invalidated.includes(pageId));
    assert(
      invalidated.includes(`${pageId}?svelte&type=script&lang.ts`),
    );
  } finally {
    Deno.removeSync(root, { recursive: true });
  }
});

Deno.test("toCssRules resolves $ prefixed keys as @scope blocks", () => {
  const rules = toCssRules(
    "test",
    {
      display: "grid",
      "$dark": {
        color: "white",
      },
      "$[data-theme='light']": {
        color: "black",
      },
    },
  );

  assert(rules.includes(".test{display:grid}"));
  assert(rules.includes("@scope (.dark){.test{color:white}}"));
  assert(rules.includes("@scope ([data-theme='light']){.test{color:black}}"));
});

Deno.test("parser preserves $ prefixed keys", () => {
  const parsed = parseInkCallArguments(`{
    base: {
      card: {
        display: "grid",
        "$dark": {
          backgroundColor: "black"
        }
      }
    }
  }`);

  assert(parsed !== null);
  const card = styleDeclarationOf(parsed.base.card);
  assertEquals(card.display, "grid");
  assertEquals(
    (card["$dark"] as Record<string, unknown>).backgroundColor,
    "black",
  );
});
