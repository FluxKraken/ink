import { assertEquals } from "jsr:@std/assert";
import * as TypeScript from "npm:typescript";
import {
  type AstSourceReplacement,
  collectRuntimeIdentifierReferences,
  collectUnusedRuntimeImportReplacements,
  type TypeScriptAstApi,
} from "./src/ast.ts";

const TYPESCRIPT = TypeScript as unknown as TypeScriptAstApi;

function applyReplacements(
  source: string,
  replacements: readonly AstSourceReplacement[],
): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (code, replacement) =>
        code.slice(0, replacement.start) + replacement.replacement +
        code.slice(replacement.end),
      source,
    );
}

function removeUnusedRuntimeImports(
  source: string,
  removableIdentifiers: ReadonlySet<string>,
  sideEffectFreeSources: ReadonlySet<string> = new Set(),
): string | null {
  const replacements = collectUnusedRuntimeImportReplacements({
    typescript: TYPESCRIPT,
    code: source,
    id: "/app/src/module.ts",
    removableIdentifiers,
    sideEffectFreeSources,
  });
  return replacements && applyReplacements(source, replacements);
}

Deno.test("runtime identifier references exclude keys, members, and types", () => {
  const references = collectRuntimeIdentifierReferences({
    typescript: TYPESCRIPT,
    code:
      `new Theme<Token>({ bg: palette.bg, Theme: "text" }) satisfies Result`,
    id: "/app/src/initializer.ts",
  });

  assertEquals(references && [...references].sort(), ["Theme", "palette"]);
});

Deno.test("unused runtime imports retain referenced and type-only specifiers", () => {
  const source =
    `import ink, { Theme, type InkConfigFile, palette as colors, unused } from "@kraken/ink" with { type: "js" };
const value = new Theme({ bg: colors.bg });`;

  assertEquals(
    removeUnusedRuntimeImports(
      source,
      new Set(["ink", "Theme", "colors", "unused"]),
    ),
    `import { Theme, type InkConfigFile, palette as colors } from "@kraken/ink" with { type: "js" };
const value = new Theme({ bg: colors.bg });`,
  );
});

Deno.test("unused default and namespace bindings are reconstructed safely", () => {
  assertEquals(
    removeUnusedRuntimeImports(
      `import ink, * as helpers from "pkg";
helpers.run();`,
      new Set(["ink", "helpers"]),
    ),
    `import * as helpers from "pkg";
helpers.run();`,
  );
});

Deno.test("fully unused bindings preserve unknown module side effects", () => {
  assertEquals(
    removeUnusedRuntimeImports(
      `import { Theme } from "pkg";
const value = { Theme: "Theme" }; // Theme`,
      new Set(["Theme"]),
    ),
    `import "pkg";
const value = { Theme: "Theme" }; // Theme`,
  );
});

Deno.test("fully unused bindings remove known side-effect-free imports", () => {
  assertEquals(
    removeUnusedRuntimeImports(
      `import ink, { Theme } from "@kraken/ink";
export const value = 1;`,
      new Set(["ink", "Theme"]),
      new Set(["@kraken/ink"]),
    ),
    `
export const value = 1;`,
  );
});

Deno.test("side-effect and type-only imports are preserved", () => {
  const source = `import "side-effect";
import type { Config } from "types";
import { unusedUserHelper } from "user-package";
export const value = 1;`;
  assertEquals(removeUnusedRuntimeImports(source, new Set(["Config"])), source);
});

Deno.test("non-target bindings remain in mixed imports", () => {
  const source = `import ink, { Theme, unusedUserHelper } from "pkg";
new Theme({});`;
  assertEquals(
    removeUnusedRuntimeImports(source, new Set(["ink", "Theme"])),
    `import { Theme, unusedUserHelper } from "pkg";
new Theme({});`,
  );
});

Deno.test("type-only references do not retain targeted runtime bindings", () => {
  const source = `import { Theme, palette } from "pkg";
type ThemeAlias = Theme;
palette();`;
  assertEquals(
    removeUnusedRuntimeImports(source, new Set(["Theme", "palette"])),
    `import { palette } from "pkg";
type ThemeAlias = Theme;
palette();`,
  );
});

Deno.test("shorthand and exported identifiers retain their imports", () => {
  const source = `import { Theme, palette } from "pkg";
export const value = { Theme };
export { palette };`;
  assertEquals(
    removeUnusedRuntimeImports(source, new Set(["Theme", "palette"])),
    source,
  );
});

Deno.test("shadowed references do not retain imports", () => {
  assertEquals(
    removeUnusedRuntimeImports(
      `import { Theme } from "pkg";
export function read(Theme: string) { return Theme; }`,
      new Set(["Theme"]),
    ),
    `import "pkg";
export function read(Theme: string) { return Theme; }`,
  );
});

Deno.test("imports with binding comments use the unchanged safe fallback", () => {
  const source = `import { /* preserve */ Theme } from "pkg";
export const value = 1;`;
  assertEquals(removeUnusedRuntimeImports(source, new Set(["Theme"])), source);
});
