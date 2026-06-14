import type * as CSS from "csstype";

/** Primitive CSS value before unit formatting. */
export type PrimitiveStyleValue = string | number;
/** Single font variation axis value keyed by its OpenType axis tag. */
export type FontVariationSettingsObject = Record<
  string,
  PrimitiveStyleValue | CssVarRef
>;
/** Array entry accepted by the `fontVariationSettings` declaration. */
export type FontVariationSettingsEntry =
  | string
  | FontVariationSettingsObject;

type NodeRequire = ((id: string) => unknown) & {
  resolve?: (id: string) => string;
};
type NodeModule = {
  createRequire: (url: string) => NodeRequire;
};

let nodeRequire: NodeRequire | null | undefined;
let tailwindMergeFn: ((...classLists: string[]) => string) | null | undefined;
const TAILWIND_MERGE_GLOBAL_KEY = "__ink_tailwind_merge__";

function setTailwindMergeGlobal(
  mergeFn: ((...classLists: string[]) => string) | undefined,
): void {
  const target = globalThis as Record<string, unknown>;
  if (mergeFn) {
    target[TAILWIND_MERGE_GLOBAL_KEY] = mergeFn;
  } else {
    delete target[TAILWIND_MERGE_GLOBAL_KEY];
  }
}

const GENERIC_FONT_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

/** Reference to a CSS custom property created by {@link cVar}. */
export interface CssVarRef {
  /** Discriminator for {@link CssVarRef} values. */
  kind: "ink-var";
  /** CSS custom property name (for example `"--brand"`). */
  name: string;
  /** Optional fallback value used in `var()` output. */
  fallback?: PrimitiveStyleValue;
}
/** CSS value accepted by style declarations. */
export type StyleValue =
  | PrimitiveStyleValue
  | CssVarRef
  | readonly (PrimitiveStyleValue | CssVarRef)[];
/** CSS value accepted specifically by `fontVariationSettings`. */
export type FontVariationSettingsValue =
  | StyleValue
  | FontVariationSettingsObject
  | readonly FontVariationSettingsEntry[];
/** CSS value accepted by style declarations. */
export type DeclarationStyleValue = StyleValue | FontVariationSettingsValue;
/** Input accepted by {@link tw}. */
export type TailwindClassInput = string | readonly string[];
/** Tailwind class marker used by `@apply` and direct style entries. */
export interface TailwindClassValue {
  /** Discriminator for {@link TailwindClassValue}. */
  kind: "ink-tailwind";
  /** Raw class list segments passed to `tailwind-merge`. */
  classNames: readonly string[];
}
/** Object form accepted by the `@set` directive. */
export interface ContainerSetInput {
  /** Container name used in `@set`. */
  name: string;
  /** Optional CSS container type (defaults to `"inline-size"` at runtime). */
  type?: string;
}
/** Input accepted by the `@set` directive. */
export type SetInput =
  | string
  | ContainerSetInput
  | readonly SetInput[];
/** Layered `@apply` payload that nests merged rules under a CSS layer. */
export interface LayeredApplyInput {
  /** Rules merged by `@apply`. */
  rules: ApplyInput;
  /** Optional CSS layer name. */
  layer?: string;
}
/** Input accepted by the `@apply` directive. */
export type ApplyInput =
  | string
  | TailwindClassValue
  | NestedStyleDeclaration
  | LayeredApplyInput
  | readonly ApplyInput[];
type CssPropertyName = keyof CSS.Properties;
type KnownCssPropertyName = {
  [Property in CssPropertyName]: string extends Property ? never
    : number extends Property ? never
    : symbol extends Property ? never
    : Property;
}[CssPropertyName];
/** Known camelCase CSS property names surfaced for TypeScript completions. */
type CssPropertyDeclaration = {
  [Property in KnownCssPropertyName as Property extends "fontVariationSettings"
    ? never
    : Property]?: StyleValue;
} & {
  fontVariationSettings?: FontVariationSettingsValue;
};
/** CSS custom properties emitted on `:root` (optionally within a layer). */
export type RootVarInput =
  | Record<string, StyleValue>
  | {
    vars: Record<string, StyleValue>;
    layer?: string;
  };
/** Friendly token map accepted by {@link Theme}, including nested token groups. */
export interface ThemeTokenInput {
  [token: string]: StyleValue | ThemeTokenInput;
}
/** Advanced theme input with an explicit selector used by custom theme mode. */
export interface ThemeAdvancedInput {
  /** Selector used as the theme scope root when `themeMode` is `"custom"`. */
  selector: string;
  /** Friendly token map converted into CSS custom properties. */
  vars: ThemeTokenInput;
}
/** Theme expansion strategy used for imported themes. */
export type ThemeMode = "scope" | "color-scheme" | "custom";
/** Theme-like value accepted by `themes`. */
export type ThemeInput = Theme | ThemeAdvanced | ThemeTokenInput;
/** Map of imported theme names/selectors to theme definitions. */
export type ImportedThemesInput = Record<string, ThemeInput>;
/** Fontsource package entry accepted by `fonts`. */
export interface FontSourceInput {
  /** CSS font-family name, for example `"Bungee"`. */
  name: string;
  /** Token name used by `font.<token>`, for example `"display"`. */
  varName: string;
  /** Fallback font families appended to the CSS variable value. */
  fallback?: string | readonly string[];
  /** Override the Fontsource import specifier. Defaults to `@fontsource/<slug>`. */
  package?: string;
}
/** Normalized Fontsource entry used internally. */
export interface ResolvedFontSource {
  /** CSS font-family name. */
  name: string;
  /** CSS custom property name emitted for this font. */
  variableName: string;
  /** Quoted `@import` specifier consumed by the runtime/Vite CSS pipeline. */
  importPath: string;
  /** CSS-safe `font-family` list assigned to the custom property. */
  family: string;
}
/** Callable font-family helper with token accessors like `font.display`. */
export type FontHelper =
  & ((families: readonly string[]) => string)
  & {
    /** Read a configured font token as a CSS variable reference. */
    readonly [token: string]: CssVarRef;
  };
/** Flat style object with only CSS declarations. */
export type PseudoStyleDeclaration = Record<string, DeclarationStyleValue>;
/** Recursive style object supporting nested selectors and at-rules. */
export type NestedStyleDeclaration = CssPropertyDeclaration & {
  [key: string]:
    | DeclarationStyleValue
    | NestedStyleDeclaration
    | ApplyInput
    | SetInput;
};
/** Style object for a single class name. */
export type StyleDeclaration = NestedStyleDeclaration;
/** Map of class keys to their style declarations. */
export type StyleSheet = Record<string, StyleDeclaration>;

/** Base shape for importing global style objects with a layer. */
export interface ImportRuleObject {
  /** The CSS style object to import as global rules. */
  rules: StyleSheet;
  /** Optional layer name for the imported styles. */
  layer?: string;
}

/** Base shape for importing external CSS files with a layer. */
export interface ImportPathObject {
  /** The external CSS string path to import. */
  path: string;
  /** Optional layer name for the imported styles. */
  layer?: string;
}

/** Import entries accepted by a Tailwind CSS config object. */
export type TailwindConfigImportInput =
  | string
  | ImportPathObject
  | readonly (string | ImportPathObject)[];

/** Plugin entries accepted by a Tailwind CSS config object. */
export type TailwindConfigPluginInput = string | readonly string[];

/** Tailwind CSS directives and global rules emitted into the Ink stylesheet. */
export interface TailwindConfigInput {
  /** Package or stylesheet imports emitted as top-level `@import` rules. */
  import?: TailwindConfigImportInput;
  /** Package plugins emitted as top-level `@plugin` rules. */
  plugin?: TailwindConfigPluginInput;
  /** `@custom-variant` entries, for example `{ dark: "&:is(.dark *)" }`. */
  customVariant?: Record<string, string>;
  /** CSS custom properties emitted in `@theme`. */
  theme?: Record<string, StyleValue>;
  /** CSS custom properties emitted in `@theme inline`. */
  themeInline?: Record<string, StyleValue>;
  /** Layered global rules emitted as `@layer <name> { ... }`. */
  layer?: Record<string, Record<string, unknown>>;
  /** Custom utilities emitted as `@utility <name> { ... }`. */
  utility?: Record<string, Record<string, unknown> | TailwindClassValue>;
  /** Additional top-level selectors or at-rules, such as `".dark"`. */
  [key: string]: unknown;
}

/** Wrapper accepted by `.import()` for Tailwind CSS config objects. */
export interface ImportTailwindObject {
  /** Tailwind CSS config object to serialize into the virtual stylesheet. */
  tailwind: TailwindConfigInput;
}

/** Serialized Tailwind CSS pieces split so imports can stay at the CSS top. */
export interface ResolvedTailwindConfigCss {
  /** Quoted `@import` specifiers consumed by the runtime/Vite CSS pipeline. */
  imports: string[];
  /** Non-import Tailwind CSS directives and global rules. */
  css: string[];
}

/** Style resolution mode used by the Vite plugin. */
export type InkResolution = "static" | "dynamic" | "hybrid";

/** Debug logging options accepted by `ink.config.ts`. */
export interface InkConfigDebugOptions {
  /** Log runtime fallback decisions. */
  logDynamic?: boolean;
  /** Log static extraction decisions. */
  logStatic?: boolean;
}

/** Container preset accepted by `ink.config.ts`. */
export interface InkConfigContainer {
  /** Optional CSS container type. */
  type?: string;
  /** Container query rule used by matching aliases. */
  rule: string;
}

/** Project-wide Ink config loaded from `ink.config.ts`. */
export interface InkConfigFile {
  /** Additional directories whose modules should be transformed by the Vite plugin. */
  include?: string | readonly string[];
  /** CSS imports emitted into the virtual stylesheet. */
  imports?: readonly string[];
  /** Explicit CSS layer order emitted as `@layer a, b, c;`. */
  layers?: readonly string[];
  /** Default unit appended to numeric style values. */
  defaultUnit?: string;
  /** Theme expansion strategy used for project-wide themes. */
  themeMode?: ThemeMode;
  /** Static extraction strategy used by the Vite plugin. */
  resolution?: InkResolution;
  /** Static/dynamic transform debug logging. */
  debug?: InkConfigDebugOptions;
  /** Named breakpoint aliases used by `@md`, `!@md`, and ranges. */
  breakpoints?: Record<string, string | number>;
  /** Breakpoint boundary mode for `@md` / `!@md` media queries. */
  breakpointBoundary?: "inclusive" | "exclusive" | "reverse";
  /** Named container presets used by `@set`, `@card`, and container ranges. */
  containers?: Record<string, InkConfigContainer> | readonly (
    InkConfigContainer & { name: string }
  )[];
  /** Named utility declarations available to `@apply`. */
  utilities?: StyleSheet;
  /** Project-wide themes emitted into the shared stylesheet. */
  themes?: ImportedThemesInput;
  /** Project-wide Fontsource fonts emitted as imports and `--font-*` variables. */
  fonts?: readonly FontSourceInput[];
}

/** Type a project-wide Ink config without changing its runtime value. */
export function defineInkConfig<const T extends InkConfigFile>(config: T): T {
  return config;
}

/** Alias for older config examples. Prefer {@link defineInkConfig}. */
export const defineCssConfig = defineInkConfig;

/** Singular import input item. */
export type SingularImportInput =
  | string
  | StyleSheet
  | ImportPathObject
  | ImportRuleObject
  | ImportTailwindObject;

/** Import shapes accepted by the `.import()` method. */
export type ImportInput = SingularImportInput | readonly SingularImportInput[];

/** Optional serialization settings shared by runtime and build-time extraction. */
export interface CssSerializationOptions {
  /** Named breakpoint aliases (for example `{ md: "48rem" }` used as `"@md"`). */
  breakpoints?: Record<string, string>;
  /** Breakpoint boundary mode for `@md` / `!@md` media queries. */
  breakpointBoundary?: "inclusive" | "exclusive" | "reverse";
  /** Named container presets (for example `{ card: { type: "inline-size", rule: "width < 20rem" } }`). */
  containers?: Record<string, { type?: string; rule: string }>;
  /** Default unit for numeric style values (for example `"px"` or `"rem"`). */
  defaultUnit?: string;
  /** Explicit CSS layer order emitted as `@layer a, b, c;`. */
  layers?: readonly string[];
}

function isPrimitiveThemeValue(
  value: unknown,
): value is PrimitiveStyleValue | CssVarRef {
  return typeof value === "string" || typeof value === "number" ||
    isCssVarRef(value);
}

function isThemeStyleValue(value: unknown): value is StyleValue {
  return isPrimitiveThemeValue(value) ||
    (Array.isArray(value) &&
      value.every((entry) => isPrimitiveThemeValue(entry)));
}

/** Convert a theme token name like `headerBG` to a CSS custom property name. */
export function toThemeVarName(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error("Theme token names must not be empty.");
  }

  return trimmed.startsWith("--") ? trimmed : `--${camelToKebab(trimmed)}`;
}

/** Convert a nested theme token path into a case-preserving CSS custom property. */
export function toThemeVarPathName(path: readonly string[]): string {
  if (path.length === 0) {
    throw new Error("Theme token paths must not be empty.");
  }

  const segments = path.map((segment) => {
    const trimmed = segment.trim();
    if (trimmed.length === 0) {
      throw new Error("Theme token names must not be empty.");
    }
    return trimmed;
  });

  if (segments.length === 1) {
    return toThemeVarName(segments[0]);
  }

  return `--${
    segments.map((segment) =>
      segment.startsWith("--") ? segment.slice(2) : segment
    ).join("-")
  }`;
}

function isThemeTokenGroup(value: unknown): value is ThemeTokenInput {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isCssVarRef(value)
  );
}

function normalizeThemeTokens(
  tokens: Record<string, unknown>,
  path: readonly string[] = [],
): Record<string, StyleValue> {
  const vars: Record<string, StyleValue> = {};

  for (const [token, value] of Object.entries(tokens)) {
    const tokenPath = [...path, token];
    if (isThemeStyleValue(value)) {
      vars[toThemeVarPathName(tokenPath)] = value;
      continue;
    }
    if (isThemeTokenGroup(value)) {
      Object.assign(vars, normalizeThemeTokens(value, tokenPath));
      continue;
    }
    throw new Error(
      `Theme token "${
        tokenPath.join(".")
      }" must be a string, number, ink variable reference, array of those values, or a nested token group.`,
    );
  }

  return vars;
}

/** First-class theme definition used by `themes`. */
export class Theme {
  /** Discriminator used for theme detection across parsing/runtime paths. */
  readonly kind = "ink-theme" as const;
  /** Normalized CSS custom properties emitted for this theme. */
  readonly vars: Record<string, StyleValue>;

  constructor(tokens: ThemeTokenInput) {
    this.vars = normalizeThemeTokens(tokens);
  }
}

/** Theme definition with an explicit selector for `themeMode: "custom"`. */
export class ThemeAdvanced {
  /** Discriminator used for theme detection across parsing/runtime paths. */
  readonly kind = "ink-theme-advanced" as const;
  /** Selector used as the theme scope root in custom theme mode. */
  readonly selector: string;
  /** Normalized CSS custom properties emitted for this theme. */
  readonly vars: Record<string, StyleValue>;

  constructor(input: ThemeAdvancedInput) {
    if (
      typeof input !== "object" || input === null ||
      Array.isArray(input)
    ) {
      throw new Error("ThemeAdvanced() expects an object argument.");
    }

    if (typeof input.selector !== "string") {
      throw new Error("ThemeAdvanced selector must be a string.");
    }

    const selector = input.selector.trim();
    if (selector.length === 0) {
      throw new Error("ThemeAdvanced selector must not be empty.");
    }
    if (
      typeof input.vars !== "object" || input.vars === null ||
      Array.isArray(input.vars)
    ) {
      throw new Error("ThemeAdvanced vars must be an object.");
    }

    this.selector = selector;
    this.vars = normalizeThemeTokens(input.vars);
  }
}

/** Type guard for {@link Theme} values. */
export function isTheme(value: unknown): value is Theme {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "ink-theme" &&
    "vars" in value &&
    typeof (value as { vars?: unknown }).vars === "object" &&
    (value as { vars?: unknown }).vars !== null &&
    !Array.isArray((value as { vars?: unknown }).vars)
  );
}

/** Type guard for {@link ThemeAdvanced} values. */
export function isThemeAdvanced(value: unknown): value is ThemeAdvanced {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind?: unknown }).kind === "ink-theme-advanced" &&
    "selector" in value &&
    typeof (value as { selector?: unknown }).selector === "string" &&
    "vars" in value &&
    typeof (value as { vars?: unknown }).vars === "object" &&
    (value as { vars?: unknown }).vars !== null &&
    !Array.isArray((value as { vars?: unknown }).vars)
  );
}

/** Create a theme-backed CSS variable reference from a friendly token name. */
export function themeVar(
  token: string,
  fallback?: PrimitiveStyleValue,
): CssVarRef {
  return cVar(toThemeVarName(token), fallback);
}

/** Expand `{token}` placeholders into `var(--token)` references. */
export function evalThemeTemplate(template: string): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, token: string) => {
    const varName = toThemeVarPathName(token.split("."));
    return `var(${varName})`;
  });
}

export type ThemeVarReference =
  & CssVarRef
  & {
    readonly [token: string]: ThemeVarReference;
  };

export type ThemeVarAccessor = Record<string, ThemeVarReference> & {
  /** Expand a CSS string template containing `{token}` placeholders. */
  eval(template: string): string;
};

function createThemeVarReference(path: readonly string[]): ThemeVarReference {
  const reference = cVar(toThemeVarPathName(path));
  return new Proxy(reference as ThemeVarReference, {
    get(target, prop, receiver) {
      if (
        typeof prop !== "string" ||
        Object.prototype.hasOwnProperty.call(target, prop)
      ) {
        return Reflect.get(target, prop, receiver);
      }
      if (prop === "then") {
        return undefined;
      }
      return createThemeVarReference([...path, prop]);
    },
  });
}

/** Proxy that maps theme token paths to CSS custom property references. */
export const tVar = new Proxy({} as ThemeVarAccessor, {
  get(_target, prop) {
    if (typeof prop !== "string") {
      return undefined;
    }
    if (prop === "eval") {
      return evalThemeTemplate;
    }
    if (prop === "then") {
      return undefined;
    }
    return createThemeVarReference([prop]);
  },
}) as ThemeVarAccessor;

function resolveImportedThemeVars(
  theme: ThemeInput,
): Record<string, StyleValue> {
  return isTheme(theme) || isThemeAdvanced(theme)
    ? theme.vars
    : normalizeThemeTokens(theme);
}

function toThemeScopeSelector(scope: string): string | null {
  const trimmed = scope.trim();
  if (
    trimmed.length === 0 || trimmed === "default" || trimmed === "root" ||
    trimmed === ":root"
  ) {
    return null;
  }

  if (
    /^[.#:[*]/.test(trimmed) ||
    /[.#:[\]\s>+~]/.test(trimmed)
  ) {
    return trimmed;
  }

  return `.${trimmed}`;
}

function toColorSchemeThemeName(scope: string): "default" | "dark" | null {
  const trimmed = scope.trim();
  if (
    trimmed.length === 0 || trimmed === "default" || trimmed === "root" ||
    trimmed === ":root"
  ) {
    return "default";
  }
  return trimmed === "dark" ? "dark" : null;
}

/** Expand `themes` into `root` vars and mode-specific global rules. */
export function themesToConfig(
  themes: ImportedThemesInput | undefined,
  themeMode: ThemeMode = "scope",
): {
  root: RootVarInput[];
  global: StyleSheet;
} {
  const root: RootVarInput[] = [];
  const global: StyleSheet = {};

  if (!themes) {
    return { root, global };
  }

  for (const [scope, theme] of Object.entries(themes)) {
    if (themeMode === "custom" && !isThemeAdvanced(theme)) {
      throw new Error(
        `themeMode "custom" requires each theme to be a ThemeAdvanced instance with a selector. Received "${scope}".`,
      );
    }

    const vars = resolveImportedThemeVars(theme);

    if (themeMode === "color-scheme") {
      const themeName = toColorSchemeThemeName(scope);
      if (themeName === null) {
        throw new Error(
          `themeMode "color-scheme" only supports "default", "root", ":root", and "dark" theme keys. Received "${scope}".`,
        );
      }

      if (themeName === "default") {
        root.push(vars);
        continue;
      }

      const mediaKey = "@media (prefers-color-scheme: dark)";
      const currentRule = (global[mediaKey] as
        | Record<string, StyleValue | StyleDeclaration>
        | undefined) ??
        {};
      const currentRoot =
        (currentRule[":root"] as Record<string, StyleValue> | undefined) ?? {};
      currentRule[":root"] = { ...currentRoot, ...vars };
      global[mediaKey] = currentRule as StyleDeclaration;
      continue;
    }

    if (themeMode === "custom") {
      const selector = toThemeScopeSelector((theme as ThemeAdvanced).selector);

      if (selector === null) {
        root.push(vars);
        continue;
      }

      const scopeKey = `@scope (${selector})`;
      const currentRule = (global[scopeKey] as
        | Record<string, StyleValue | StyleDeclaration>
        | undefined) ??
        {};
      const currentScope =
        (currentRule[":scope"] as Record<string, StyleValue> | undefined) ??
          {};
      currentRule[":scope"] = { ...currentScope, ...vars };
      global[scopeKey] = currentRule as StyleDeclaration;
      continue;
    }

    const selector = toThemeScopeSelector(scope);

    if (selector === null) {
      root.push(vars);
      continue;
    }

    const scopeKey = `@scope (${selector})`;
    const currentRule = (global[scopeKey] as
      | Record<string, StyleValue | StyleDeclaration>
      | undefined) ??
      {};
    const currentScope =
      (currentRule[":scope"] as Record<string, StyleValue> | undefined) ?? {};
    currentRule[":scope"] = { ...currentScope, ...vars };
    global[scopeKey] = currentRule as StyleDeclaration;
  }

  return { root, global };
}

const UNITLESS_PROPERTIES = new Set([
  "line-height",
  "font-weight",
  "opacity",
  "z-index",
  "flex",
  "flex-grow",
  "flex-shrink",
  "order",
  "grid-row",
  "grid-column",
]);

const COMMA_DELIMITED_PROPERTIES = new Set([
  "animation",
  "animation-delay",
  "animation-direction",
  "animation-duration",
  "animation-fill-mode",
  "animation-iteration-count",
  "animation-name",
  "animation-play-state",
  "animation-timing-function",
  "background",
  "background-attachment",
  "background-clip",
  "background-image",
  "background-origin",
  "background-position",
  "background-repeat",
  "background-size",
  "box-shadow",
  "font-family",
  "mask",
  "mask-clip",
  "mask-composite",
  "mask-image",
  "mask-mode",
  "mask-origin",
  "mask-position",
  "mask-repeat",
  "mask-size",
  "text-shadow",
  "transition",
  "transition-delay",
  "transition-duration",
  "transition-property",
  "transition-timing-function",
]);

const AUTO_URL_IMAGE_PROPERTIES = new Set([
  "background",
  "background-image",
  "border-image",
  "border-image-source",
  "list-style",
  "list-style-image",
  "mask",
  "mask-border",
  "mask-border-source",
  "mask-image",
]);

const IMAGE_ASSET_VALUE_PATTERN =
  /\.(?:apng|avif|bmp|gif|ico|jpe?g|png|svg|tiff?|webp)(?:[?#].*)?$/i;

const RAW_CSS_IMAGE_PREFIXES = [
  "conic-gradient(",
  "cross-fade(",
  "element(",
  "image(",
  "image-set(",
  "linear-gradient(",
  "paint(",
  "radial-gradient(",
  "repeating-conic-gradient(",
  "repeating-linear-gradient(",
  "repeating-radial-gradient(",
  "url(",
  "var(",
];

function shouldAutoWrapImageValue(property: string, value: string): boolean {
  if (!AUTO_URL_IMAGE_PROPERTIES.has(property)) {
    return false;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "none" ||
    RAW_CSS_IMAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  ) {
    return false;
  }

  if (
    normalized.startsWith("data:image/") ||
    normalized.startsWith("blob:")
  ) {
    return true;
  }

  return IMAGE_ASSET_VALUE_PATTERN.test(trimmed);
}

function formatCssImageUrl(value: string): string {
  return `url(${JSON.stringify(value.trim())})`;
}

function shouldQuoteFontFamily(value: string): boolean {
  return !/^-?-?[_A-Za-z][-_A-Za-z0-9]*$/.test(value);
}

function formatFontFamily(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("font() family names must not be empty.");
  }

  const normalized = trimmed.toLowerCase();
  if (
    isQuotedCssString(trimmed) ||
    GENERIC_FONT_FAMILIES.has(normalized) ||
    trimmed.startsWith("var(")
  ) {
    return trimmed;
  }

  return shouldQuoteFontFamily(trimmed) ? JSON.stringify(trimmed) : trimmed;
}

function formatFontFamilies(families: readonly string[]): string {
  if (!Array.isArray(families)) {
    throw new Error("font() expects an array of font family names.");
  }

  if (families.length === 0) {
    throw new Error("font() expects at least one font family name.");
  }

  return families.map((family) => {
    if (typeof family !== "string") {
      throw new Error("font() family names must be strings.");
    }
    return formatFontFamily(family);
  }).join(", ");
}

const FONT_HELPER_RESERVED_PROPERTIES = new Set([
  "apply",
  "arguments",
  "bind",
  "call",
  "caller",
  "constructor",
  "length",
  "name",
  "prototype",
  "toString",
  "valueOf",
]);

/** Whether a property name can be used as a `font.<token>` accessor. */
export function isFontTokenProperty(prop: string): boolean {
  return prop !== "then" && !FONT_HELPER_RESERVED_PROPERTIES.has(prop);
}

/** Convert a font token like `display` to a CSS custom property name. */
export function toFontVarName(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    throw new Error("Font token names must not be empty.");
  }

  if (trimmed.startsWith("--")) {
    return trimmed;
  }

  const kebab = camelToKebab(trimmed);
  return kebab.startsWith("font-") ? `--${kebab}` : `--font-${kebab}`;
}

/** Create a Fontsource package slug from a CSS font-family name. */
export function fontSourceSlug(name: string): string {
  const slug = name.trim().toLowerCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length === 0) {
    throw new Error("Fontsource font names must produce a non-empty slug.");
  }
  return slug;
}

function normalizeFontFallback(value: FontSourceInput["fallback"]): string[] {
  if (value === undefined) {
    return ["system-ui"];
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? [trimmed] : [];
  }

  if (!Array.isArray(value)) {
    throw new Error(
      "Fontsource font fallback must be a string or string array.",
    );
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw new Error("Fontsource font fallback entries must be strings.");
    }
    return entry.trim();
  }).filter((entry) => entry.length > 0);
}

/** Normalize `fonts` into CSS imports and root variable definitions. */
export function fontsToConfig(
  fonts: readonly FontSourceInput[] | undefined,
): {
  imports: string[];
  root: RootVarInput[];
  resolved: ResolvedFontSource[];
} {
  if (!fonts) {
    return { imports: [], root: [], resolved: [] };
  }

  if (!Array.isArray(fonts)) {
    throw new Error("fonts expects an array of Fontsource font entries.");
  }

  const imports: string[] = [];
  const root: RootVarInput[] = [];
  const resolved: ResolvedFontSource[] = [];

  for (const entry of fonts) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("fonts entries must be objects.");
    }
    if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
      throw new Error("fonts entries require a non-empty name.");
    }
    if (
      typeof entry.varName !== "string" || entry.varName.trim().length === 0
    ) {
      throw new Error("fonts entries require a non-empty varName.");
    }

    const name = entry.name.trim();
    const variableName = toFontVarName(entry.varName);
    const packagePath =
      typeof entry.package === "string" && entry.package.trim().length > 0
        ? entry.package.trim()
        : `@fontsource/${fontSourceSlug(name)}`;
    const family = formatFontFamilies([
      name,
      ...normalizeFontFallback(
        entry.fallback,
      ),
    ]);
    const importPath = JSON.stringify(packagePath);

    imports.push(importPath);
    root.push({ [variableName]: family });
    resolved.push({ name, variableName, importPath, family });
  }

  return {
    imports: Array.from(new Set(imports)),
    root,
    resolved,
  };
}

/** Create a CSS-safe `font-family` list or read configured font tokens. */
export const font = new Proxy(formatFontFamilies, {
  get(target, prop, receiver) {
    if (prop === "then") {
      return undefined;
    }
    if (typeof prop !== "string" || !isFontTokenProperty(prop)) {
      return Reflect.get(target, prop, receiver);
    }
    return cVar(toFontVarName(prop));
  },
}) as FontHelper;

function getBuiltinModule(id: string): unknown | null {
  const processValue = (globalThis as { process?: unknown }).process;
  if (!processValue || typeof processValue !== "object") {
    return null;
  }

  const getBuiltinModule =
    (processValue as { getBuiltinModule?: unknown }).getBuiltinModule;
  if (typeof getBuiltinModule !== "function") {
    return null;
  }

  try {
    return (getBuiltinModule as (name: string) => unknown)(id);
  } catch {
    return null;
  }
}

function getFallbackRequire(): NodeRequire | null {
  try {
    const req = new Function(
      'return typeof require === "function" ? require : null;',
    )();
    return typeof req === "function" ? (req as NodeRequire) : null;
  } catch {
    return null;
  }
}

function getNodeRequire(): NodeRequire | null {
  if (nodeRequire !== undefined) {
    return nodeRequire;
  }

  const moduleBuiltin = getBuiltinModule("node:module") as NodeModule | null;
  if (moduleBuiltin && typeof moduleBuiltin.createRequire === "function") {
    nodeRequire = moduleBuiltin.createRequire(import.meta.url);
    return nodeRequire;
  }

  nodeRequire = getFallbackRequire();
  return nodeRequire;
}

function normalizeTailwindClassInput(input: TailwindClassInput): string[] {
  const entries = typeof input === "string" ? [input] : [...input];
  const normalized: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string") {
      throw new Error("tw() expects a string or an array of strings.");
    }

    const trimmed = entry.trim();
    if (trimmed.length > 0) {
      normalized.push(trimmed);
    }
  }

  return normalized;
}

/** Create a Tailwind class marker for `@apply` or direct style entries. */
export function tw(input: TailwindClassInput): TailwindClassValue {
  return {
    kind: "ink-tailwind",
    classNames: normalizeTailwindClassInput(input),
  };
}

/** Type guard for {@link TailwindClassValue}. */
export function isTailwindClassValue(
  value: unknown,
): value is TailwindClassValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as TailwindClassValue).kind === "ink-tailwind" &&
    "classNames" in value &&
    Array.isArray((value as TailwindClassValue).classNames) &&
    (value as TailwindClassValue).classNames.every((entry) =>
      typeof entry === "string"
    )
  );
}

/** Set the Tailwind merge implementation used by `tw(...)` class composition. */
export function setTailwindMerge(
  mergeFn: ((...classLists: string[]) => string) | undefined,
): void {
  tailwindMergeFn = mergeFn;
  setTailwindMergeGlobal(mergeFn);
}

function resolveTailwindMerge(): (...classLists: string[]) => string {
  if (tailwindMergeFn) {
    return tailwindMergeFn;
  }

  if (tailwindMergeFn === null) {
    throw new Error(
      'tw() requires the optional dependency "tailwind-merge". Install it to use Tailwind class support.',
    );
  }

  const injectedMerge = (
    globalThis as Record<string, unknown>
  )[TAILWIND_MERGE_GLOBAL_KEY];
  if (typeof injectedMerge === "function") {
    tailwindMergeFn = injectedMerge as (...classLists: string[]) => string;
    return tailwindMergeFn;
  }

  const requireFn = getNodeRequire();
  if (requireFn) {
    try {
      const loaded = requireFn("tailwind-merge") as
        | { twMerge?: unknown; default?: { twMerge?: unknown } }
        | null;
      const mergeFn = typeof loaded?.twMerge === "function"
        ? loaded.twMerge
        : typeof loaded?.default?.twMerge === "function"
        ? loaded.default.twMerge
        : null;
      if (mergeFn) {
        tailwindMergeFn = mergeFn as (...classLists: string[]) => string;
        return tailwindMergeFn;
      }
    } catch {
      // Defer the user-facing error until after all sync loading strategies fail.
    }
  }

  tailwindMergeFn = null;
  throw new Error(
    'tw() requires the optional dependency "tailwind-merge". Install it to use Tailwind class support.',
  );
}

/** Merge Tailwind class lists using the optional `tailwind-merge` dependency. */
export function mergeTailwindClassNames(
  classLists: readonly string[],
): string {
  const normalized = classLists
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (normalized.length === 0) {
    return "";
  }

  return resolveTailwindMerge()(...normalized);
}

/** Convert a camelCased property name to kebab-case. */
export function camelToKebab(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Create a short, deterministic hash for class name generation. */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 33) ^ input.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Build a stable class name from a style key and declaration.
 * @param key Unique key for the style.
 * @param declaration Style declaration to fingerprint.
 * @param salt Optional salt to namespace class names.
 */
export function createClassName(
  key: string,
  declaration: StyleDeclaration,
  salt = "",
): string {
  const fingerprint = JSON.stringify({ key, declaration, salt });
  return `ink_${hashString(fingerprint).slice(0, 8)}`;
}

/**
 * Convert a style property to a CSS declaration string.
 * @param name Property name in camelCase.
 * @param value Style value to serialize.
 * @param options Optional serialization settings (breakpoints, containers, default unit).
 */
export function toCssDeclaration(
  name: string,
  value: DeclarationStyleValue,
  options?: CssSerializationOptions,
): string {
  const property = name.startsWith("--") ? name : camelToKebab(name);
  return `${property}:${formatStyleValue(property, value, options)}`;
}

const PSEUDO_ELEMENT_KEYS = new Set([
  "before",
  "after",
  "firstLine",
  "firstLetter",
  "selection",
  "placeholder",
  "marker",
  "backdrop",
  "fileSelectorButton",
]);

const PSEUDO_CLASS_KEYS = new Set([
  "active",
  "checked",
  "default",
  "disabled",
  "empty",
  "enabled",
  "first-child",
  "first-of-type",
  "focus",
  "focus-visible",
  "focus-within",
  "has",
  "hover",
  "in-range",
  "indeterminate",
  "invalid",
  "is",
  "last-child",
  "last-of-type",
  "link",
  "not",
  "nth-child",
  "nth-last-child",
  "nth-last-of-type",
  "nth-of-type",
  "only-child",
  "only-of-type",
  "optional",
  "out-of-range",
  "placeholder-shown",
  "read-only",
  "read-write",
  "required",
  "root",
  "target",
  "valid",
  "visited",
  "where",
]);

function isNestedStyleDeclaration(
  value: unknown,
): value is NestedStyleDeclaration {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isCssVarRef(value)
  );
}

function isFontVariationSettingsProperty(property: string): boolean {
  return property === "font-variation-settings";
}

function isFontVariationAxisValue(
  value: unknown,
): value is PrimitiveStyleValue | CssVarRef {
  return typeof value === "string" || typeof value === "number" ||
    isCssVarRef(value);
}

function isFontVariationSettingsObject(
  value: unknown,
): value is FontVariationSettingsObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isCssVarRef(value) &&
    Object.entries(value).every(([axis, axisValue]) =>
      axis.trim().length > 0 && isFontVariationAxisValue(axisValue)
    )
  );
}

function isFontVariationSettingsValue(
  value: unknown,
): value is FontVariationSettingsValue {
  if (
    typeof value === "string" || typeof value === "number" ||
    isCssVarRef(value) || isFontVariationSettingsObject(value)
  ) {
    return true;
  }

  if (!Array.isArray(value)) {
    return false;
  }

  return value.every((entry) =>
    typeof entry === "string" || isFontVariationSettingsObject(entry)
  );
}

function isDeclarationStyleValue(
  property: string,
  value: unknown,
): value is DeclarationStyleValue {
  return isThemeStyleValue(value) ||
    (isFontVariationSettingsProperty(property) &&
      isFontVariationSettingsValue(value));
}

function toPseudoSelectorIfShorthand(key: string): string | null {
  if (PSEUDO_ELEMENT_KEYS.has(key)) {
    return `::${camelToKebab(key)}`;
  }
  const pseudoClass = camelToKebab(key);
  if (PSEUDO_CLASS_KEYS.has(pseudoClass)) {
    return `:${pseudoClass}`;
  }
  return null;
}

function toTailwindVariantFromPseudoSelector(selector: string): string | null {
  const normalized = selector.trim().startsWith("&")
    ? selector.trim().slice(1)
    : selector.trim();

  if (normalized.startsWith("::")) {
    const variant = normalized.slice(2).trim();
    return /^[A-Za-z-]+$/.test(variant) ? camelToKebab(variant) : null;
  }

  if (normalized.startsWith(":")) {
    const variant = normalized.slice(1).trim();
    return /^[A-Za-z-]+$/.test(variant) ? camelToKebab(variant) : null;
  }

  return null;
}

/** Map a nested selector key like `hover` or `&:focus-visible` to a Tailwind variant prefix. */
export function toTailwindVariantForNestedKey(key: string): string | null {
  const trimmed = key.trim();
  if (
    trimmed.length === 0 ||
    trimmed.startsWith("@") ||
    trimmed.startsWith("$")
  ) {
    return null;
  }

  const pseudoSelector = toPseudoSelectorIfShorthand(trimmed);
  if (pseudoSelector) {
    return toTailwindVariantFromPseudoSelector(pseudoSelector);
  }

  return toTailwindVariantFromPseudoSelector(trimmed);
}

/** Prefix Tailwind class tokens with a variant like `hover:` or `before:`. */
export function prefixTailwindVariantClasses(
  classNames: readonly string[],
  variant: string,
): string[] {
  return classNames
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      entry.split(/\s+/).map((token) => `${variant}:${token}`).join(" ")
    );
}

function toCssRule(
  selector: string,
  declaration: PseudoStyleDeclaration,
  options?: CssSerializationOptions,
): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(declaration)) {
    if (name === "@apply") {
      const classList = Array.isArray(value) ? value.join(" ") : String(value);
      if (classList.trim().length > 0) {
        parts.push(`@apply ${classList.trim()}`);
      }
      continue;
    }
    parts.push(toCssDeclaration(name, value, options));
  }
  return `${selector}{${parts.join(";")}}`;
}

function splitSelectors(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter((part) =>
    part.length > 0
  );
}

function unwrapGlobalSelector(value: string): string {
  return value.replace(/:global\(([^()]+)\)/g, "$1");
}

function extractScopeSelector(
  key: string,
  declaration: StyleDeclaration,
): string | null {
  if (key === "@scope") {
    const selector = declaration.selector;
    return typeof selector === "string" && selector.trim().length > 0
      ? unwrapGlobalSelector(selector.trim())
      : null;
  }

  const embeddedMatch = key.match(/^@scope\s*\((.+)\)$/);
  if (!embeddedMatch || embeddedMatch[1].trim().length === 0) {
    return null;
  }

  return unwrapGlobalSelector(embeddedMatch[1].trim());
}

function isScopeDirectiveDeclaration(
  value: unknown,
): value is StyleDeclaration {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !isCssVarRef(value);
}

function nestSelector(parentSelector: string, childSelector: string): string {
  const parents = splitSelectors(parentSelector);
  const children = splitSelectors(childSelector);

  if (childSelector.includes("&")) {
    const expanded: string[] = [];
    for (const parent of parents) {
      for (const child of children) {
        expanded.push(child.replace(/&/g, parent));
      }
    }
    return expanded.join(", ");
  }

  const pseudoSelector =
    childSelector.startsWith(":") || childSelector.startsWith("::")
      ? childSelector
      : toPseudoSelectorIfShorthand(childSelector);
  if (pseudoSelector) {
    return parents.map((parent) => `${parent}${pseudoSelector}`).join(", ");
  }

  const expanded: string[] = [];
  for (const parent of parents) {
    for (const child of children) {
      expanded.push(`${parent} ${child}`);
    }
  }
  return expanded.join(", ");
}

function wrapInAtRules(rule: string, atRules: readonly string[]): string {
  let wrapped = rule;
  for (let i = atRules.length - 1; i >= 0; i -= 1) {
    wrapped = `${atRules[i]}{${wrapped}}`;
  }
  return wrapped;
}

function isSupportedAtRule(key: string): boolean {
  return key.startsWith("@") || key.startsWith("!@") || key.startsWith("$");
}

function resolveAtRule(key: string, options?: CssSerializationOptions): string {
  const breakpointBoundary = options?.breakpointBoundary ?? "inclusive";
  const reverseBoundary = breakpointBoundary === "exclusive" ||
    breakpointBoundary === "reverse";

  if (key.startsWith("$")) {
    const scope = key.slice(1);
    const selector = toThemeScopeSelector(scope);
    return selector ? `@scope (${selector})` : `@scope (:root)`;
  }

  if (!(key.startsWith("@") || key.startsWith("!@"))) {
    return key;
  }

  const reverseAliasMatch = key.match(/^!@([A-Za-z0-9_$-]+)$/);
  if (reverseAliasMatch) {
    const reverseBreakpoint = options?.breakpoints?.[reverseAliasMatch[1]];
    if (reverseBreakpoint) {
      return reverseBoundary
        ? `@media (width <= ${reverseBreakpoint})`
        : `@media (width < ${reverseBreakpoint})`;
    }
    return key;
  }

  const rangeMatch = key.match(
    /^@\(\s*([A-Za-z0-9_$-]+)\s*,\s*([A-Za-z0-9_$-]+)\s*\)$/,
  );
  if (rangeMatch) {
    const lower = options?.breakpoints?.[rangeMatch[1]];
    const upper = options?.breakpoints?.[rangeMatch[2]];
    if (lower && upper) {
      return `@media (${lower} < width < ${upper})`;
    }

    const lowerContainer = options?.containers?.[rangeMatch[1]];
    const upperContainer = options?.containers?.[rangeMatch[2]];
    if (lowerContainer?.rule && upperContainer?.rule) {
      return `@container (${lowerContainer.rule}) and (${upperContainer.rule})`;
    }

    return key;
  }

  const aliasMatch = key.match(/^@([A-Za-z0-9_$-]+)$/);
  if (!aliasMatch) {
    return key;
  }

  const breakpoint = options?.breakpoints?.[aliasMatch[1]];
  if (!breakpoint) {
    const container = options?.containers?.[aliasMatch[1]];
    if (container?.rule) {
      return `@container ${aliasMatch[1]} (${container.rule})`;
    }
    return key;
  }

  return reverseBoundary
    ? `@media (width > ${breakpoint})`
    : `@media (width >= ${breakpoint})`;
}

function collectCssRules(
  selector: string,
  declaration: StyleDeclaration,
  atRules: readonly string[],
  rules: string[],
  options?: CssSerializationOptions,
): void {
  const base: PseudoStyleDeclaration = {};
  const nested: Array<[string, NestedStyleDeclaration]> = [];

  for (const [name, value] of Object.entries(declaration)) {
    if (isDeclarationStyleValue(camelToKebab(name), value)) {
      base[name] = value;
      continue;
    }

    if (isNestedStyleDeclaration(value)) {
      nested.push([name, value]);
      continue;
    }
  }

  if (Object.keys(base).length > 0) {
    rules.push(wrapInAtRules(toCssRule(selector, base, options), atRules));
  }

  for (const [name, value] of nested) {
    if (isSupportedAtRule(name)) {
      collectCssRules(
        selector,
        value,
        [...atRules, resolveAtRule(name, options)],
        rules,
        options,
      );
      continue;
    }

    collectCssRules(
      nestSelector(selector, name),
      value,
      atRules,
      rules,
      options,
    );
  }
}

/**
 * Build CSS rules for a class name, including nested selectors and at-rules.
 * @param className Class name without the leading dot.
 * @param declaration Style declaration to serialize.
 */
export function toCssRules(
  className: string,
  declaration: StyleDeclaration,
  options?: CssSerializationOptions,
): string[] {
  const rules: string[] = [];
  collectCssRules(`.${className}`, declaration, [], rules, options);
  return rules;
}

function collectGlobalCssRules(
  selectorOrAtRule: string,
  declaration: StyleDeclaration,
  atRules: readonly string[],
  rules: string[],
  options?: CssSerializationOptions,
): void {
  const scopeSelector = extractScopeSelector(selectorOrAtRule, declaration);
  if (scopeSelector !== null) {
    const scopedRules: string[] = [];
    for (const [name, value] of Object.entries(declaration)) {
      if (
        (selectorOrAtRule === "@scope" && name === "selector") ||
        !isScopeDirectiveDeclaration(value)
      ) {
        continue;
      }
      collectGlobalCssRules(name, value, [], scopedRules, options);
    }

    rules.push(
      wrapInAtRules(
        `@scope (${scopeSelector}){${scopedRules.join("")}}`,
        atRules,
      ),
    );
    return;
  }

  if (isSupportedAtRule(selectorOrAtRule)) {
    const nestedAtRules = [
      ...atRules,
      resolveAtRule(selectorOrAtRule, options),
    ];
    const nestedDeclarations: PseudoStyleDeclaration = {};

    for (const [name, value] of Object.entries(declaration)) {
      if (isDeclarationStyleValue(camelToKebab(name), value)) {
        nestedDeclarations[name] = value;
        continue;
      }

      if (isNestedStyleDeclaration(value)) {
        collectGlobalCssRules(name, value, nestedAtRules, rules, options);
        continue;
      }
    }

    if (Object.keys(nestedDeclarations).length > 0) {
      rules.push(
        wrapInAtRules(
          toCssRule(selectorOrAtRule, nestedDeclarations, options),
          atRules,
        ),
      );
    }

    return;
  }

  collectCssRules(
    unwrapGlobalSelector(selectorOrAtRule),
    declaration,
    atRules,
    rules,
    options,
  );
}

/**
 * Build CSS rules for global selectors/at-rules without generating class names.
 * @param styles Selector/at-rule map to serialize.
 */
export function toCssGlobalRules(
  styles: StyleSheet,
  options?: CssSerializationOptions,
): string[] {
  const rules: string[] = [];
  for (const [selectorOrAtRule, declaration] of Object.entries(styles)) {
    collectGlobalCssRules(selectorOrAtRule, declaration, [], rules, options);
  }
  return rules;
}

/** Convert configured layer names into a CSS layer order prelude. */
export function toCssLayerOrderRule(
  layers: readonly string[] | undefined,
): string {
  if (!layers || layers.length === 0) {
    return "";
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const layer of layers) {
    const trimmed = layer.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  }

  if (normalized.length === 0) {
    return "";
  }

  const statement = `@layer ${normalized.join(", ")};`;
  // Keep empty layer blocks as a fallback because Vite/Svelte dev CSS inlining
  // can drop bare layer-order statements during SSR style collection.
  const fallbackBlocks = normalized.map((layer) => `@layer ${layer}{}`).join(
    "",
  );

  return `${statement}${fallbackBlocks}`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    !isCssVarRef(value);
}

function toQuotedImportSpecifier(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("Tailwind import paths must not be empty.");
  }
  if (/^["'][\s\S]*["'](?:\s+layer\([^)]+\))?$/.test(trimmed)) {
    return trimmed;
  }
  return JSON.stringify(trimmed);
}

function toQuotedPluginSpecifier(path: string): string {
  const trimmed = path.trim();
  if (trimmed.length === 0) {
    throw new Error("Tailwind plugin paths must not be empty.");
  }
  if (/^["'][\s\S]*["']$/.test(trimmed)) {
    return trimmed;
  }
  return JSON.stringify(trimmed);
}

function normalizeTailwindImportEntry(entry: unknown): string {
  if (typeof entry === "string") {
    return toQuotedImportSpecifier(entry);
  }

  if (isPlainRecord(entry) && typeof entry.path === "string") {
    const importPath = toQuotedImportSpecifier(entry.path);
    const layer = typeof entry.layer === "string" ? entry.layer.trim() : "";
    return layer.length > 0 ? `${importPath} layer(${layer})` : importPath;
  }

  throw new Error(
    "Tailwind import entries must be strings or { path, layer? } objects.",
  );
}

function normalizeTailwindImportInput(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return Array.from(new Set(entries.map(normalizeTailwindImportEntry)));
}

function normalizeTailwindPluginEntry(entry: unknown): string {
  if (typeof entry === "string") {
    return toQuotedPluginSpecifier(entry);
  }

  throw new Error("Tailwind plugin entries must be strings.");
}

function normalizeTailwindPluginInput(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : [value];
  return Array.from(new Set(entries.map(normalizeTailwindPluginEntry)));
}

function tailwindClassListToCss(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : "";
  }

  if (isTailwindClassValue(value)) {
    return value.classNames
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
      .join(" ");
  }

  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const entry of value) {
      const resolved = tailwindClassListToCss(entry);
      if (resolved === null) {
        return null;
      }
      if (resolved.length > 0) {
        parts.push(resolved);
      }
    }
    return parts.join(" ");
  }

  return null;
}

function toTailwindDeclarationBlock(value: unknown): string {
  if (isTailwindClassValue(value)) {
    const classList = tailwindClassListToCss(value);
    return classList && classList.length > 0 ? `@apply ${classList};` : "";
  }

  if (!isPlainRecord(value)) {
    throw new Error(
      "Tailwind CSS rule blocks must be objects or tw(...) values.",
    );
  }

  const parts: string[] = [];
  for (const [name, declarationValue] of Object.entries(value)) {
    if (name === "@apply") {
      const classList = tailwindClassListToCss(declarationValue);
      if (classList === null) {
        throw new Error(
          'Tailwind "@apply" values must be strings, tw(...) values, or arrays of those.',
        );
      }
      if (classList.length > 0) {
        parts.push(`@apply ${classList};`);
      }
      continue;
    }

    if (isDeclarationStyleValue(camelToKebab(name), declarationValue)) {
      parts.push(`${toCssDeclaration(name, declarationValue)};`);
      continue;
    }

    if (
      isPlainRecord(declarationValue) || isTailwindClassValue(declarationValue)
    ) {
      parts.push(`${name}{${toTailwindDeclarationBlock(declarationValue)}}`);
      continue;
    }

    throw new Error(
      `Tailwind CSS property "${name}" must be a CSS value, nested rule, or tw(...) value.`,
    );
  }

  return parts.join("");
}

function toTailwindRule(selector: string, declaration: unknown): string {
  const trimmedSelector = selector.trim();
  if (trimmedSelector.length === 0) {
    throw new Error("Tailwind CSS selectors must not be empty.");
  }
  return `${trimmedSelector}{${toTailwindDeclarationBlock(declaration)}}`;
}

function toTailwindRuleMap(value: unknown): string {
  if (!isPlainRecord(value)) {
    throw new Error("Tailwind CSS rule maps must be objects.");
  }
  return Object.entries(value)
    .map(([selector, declaration]) => toTailwindRule(selector, declaration))
    .join("");
}

function toTailwindCustomVariantRules(value: unknown): string[] {
  if (!isPlainRecord(value)) {
    throw new Error("customVariant must be an object.");
  }

  const rules: string[] = [];
  for (const [name, selector] of Object.entries(value)) {
    const variantName = name.trim();
    if (variantName.length === 0 || typeof selector !== "string") {
      throw new Error("customVariant entries must map names to selectors.");
    }
    const trimmedSelector = selector.trim();
    if (trimmedSelector.length === 0) {
      throw new Error("customVariant selectors must not be empty.");
    }
    rules.push(`@custom-variant ${variantName} (${trimmedSelector});`);
  }
  return rules;
}

function toTailwindPluginRules(value: unknown): string[] {
  return normalizeTailwindPluginInput(value).map((pluginPath) =>
    `@plugin ${pluginPath};`
  );
}

function toTailwindLayerRules(value: unknown): string[] {
  if (!isPlainRecord(value)) {
    throw new Error("layer must be an object.");
  }

  const rules: string[] = [];
  for (const [layerName, layerRules] of Object.entries(value)) {
    const normalizedLayer = layerName.trim();
    if (normalizedLayer.length === 0) {
      throw new Error("Tailwind layer names must not be empty.");
    }
    rules.push(`@layer ${normalizedLayer}{${toTailwindRuleMap(layerRules)}}`);
  }
  return rules;
}

function toTailwindUtilityRules(value: unknown): string[] {
  if (!isPlainRecord(value)) {
    throw new Error("utility must be an object.");
  }

  const rules: string[] = [];
  for (const [utilityName, declaration] of Object.entries(value)) {
    const normalizedUtility = utilityName.trim();
    if (normalizedUtility.length === 0) {
      throw new Error("Tailwind utility names must not be empty.");
    }
    rules.push(
      `@utility ${normalizedUtility}{${
        toTailwindDeclarationBlock(declaration)
      }}`,
    );
  }
  return rules;
}

/**
 * Serialize an Ink Tailwind config object into CSS that Tailwind can process.
 * Imports are returned separately so callers can emit all `@import` rules first.
 */
export function tailwindConfigToCss(
  config: TailwindConfigInput,
): ResolvedTailwindConfigCss {
  if (!isPlainRecord(config)) {
    throw new Error("tailwind config imports must be objects.");
  }

  const imports: string[] = [];
  const css: string[] = [];

  for (const [key, value] of Object.entries(config)) {
    if (key === "import") {
      imports.push(...normalizeTailwindImportInput(value));
      continue;
    }
    if (key === "plugin") {
      css.push(...toTailwindPluginRules(value));
      continue;
    }
    if (key === "customVariant") {
      css.push(...toTailwindCustomVariantRules(value));
      continue;
    }
    if (key === "theme") {
      css.push(`@theme{${toTailwindDeclarationBlock(value)}}`);
      continue;
    }
    if (key === "themeInline") {
      css.push(`@theme inline{${toTailwindDeclarationBlock(value)}}`);
      continue;
    }
    if (key === "layer") {
      css.push(...toTailwindLayerRules(value));
      continue;
    }
    if (key === "utility") {
      css.push(...toTailwindUtilityRules(value));
      continue;
    }
    if (key === "root") {
      css.push(toTailwindRule(":root", value));
      continue;
    }

    css.push(toTailwindRule(key, value));
  }

  return {
    imports: Array.from(new Set(imports)),
    css,
  };
}

/** Convert `root`/`rootVars` inputs into global `:root` rules. */
export function rootVarsToGlobalRules(
  rootVars: readonly RootVarInput[] | undefined,
): StyleSheet {
  const globalRules: StyleSheet = {};
  if (!rootVars) {
    return globalRules;
  }

  for (const entry of rootVars) {
    const vars = ("vars" in entry ? entry.vars : entry) as Record<
      string,
      StyleValue
    >;
    const layer = "layer" in entry && typeof entry.layer === "string" &&
        entry.layer.trim().length > 0
      ? entry.layer.trim()
      : null;

    if (layer) {
      const layerKey = `@layer ${layer}`;
      const layerRules =
        (globalRules[layerKey] as StyleDeclaration | undefined) ?? {};
      const rootDeclaration =
        (layerRules[":root"] as Record<string, StyleValue> | undefined) ?? {};
      layerRules[":root"] = { ...rootDeclaration, ...vars };
      globalRules[layerKey] = layerRules;
      continue;
    }

    const rootDeclaration =
      (globalRules[":root"] as Record<string, StyleValue> | undefined) ?? {};
    globalRules[":root"] = { ...rootDeclaration, ...vars };
  }

  return globalRules;
}

/**
 * Create a CSS custom property reference for use in style objects.
 * @param name CSS custom property name (must start with `--`).
 * @param fallback Optional fallback value for the `var()` call.
 */
export function cVar(name: string, fallback?: PrimitiveStyleValue): CssVarRef {
  if (!name.startsWith("--")) {
    throw new Error(
      `Expected a CSS variable name like "--token", got "${name}"`,
    );
  }

  if (
    fallback !== undefined && typeof fallback !== "string" &&
    typeof fallback !== "number"
  ) {
    throw new Error("cVar() fallback must be a string or number");
  }

  return {
    kind: "ink-var",
    name,
    fallback,
  };
}

/**
 * Type guard for {@link CssVarRef} values.
 * @param value Unknown value to test.
 */
export function isCssVarRef(value: unknown): value is CssVarRef {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as CssVarRef).kind === "ink-var"
  );
}

function formatPrimitiveStyleValue(
  property: string,
  value: PrimitiveStyleValue,
  options?: CssSerializationOptions,
): string {
  if (property === "content" && typeof value === "string") {
    return formatContentValue(value);
  }

  if (property === "grid-template-areas" && typeof value === "string") {
    return formatGridTemplateAreasValue(value);
  }

  if (typeof value === "string" && shouldAutoWrapImageValue(property, value)) {
    return formatCssImageUrl(value);
  }

  if (typeof value === "number" && !UNITLESS_PROPERTIES.has(property)) {
    return `${value}${options?.defaultUnit ?? "px"}`;
  }
  return String(value);
}

const RAW_CONTENT_KEYWORDS = new Set([
  "none",
  "normal",
  "open-quote",
  "close-quote",
  "no-open-quote",
  "no-close-quote",
]);

function isQuotedCssString(value: string): boolean {
  return (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  );
}

function isRawContentFunction(value: string): boolean {
  return /^(attr|counter|counters|element|leader|target-counter|target-counters|target-text|string)\(/
    .test(value);
}

function formatContentValue(value: string): string {
  if (
    isQuotedCssString(value) || RAW_CONTENT_KEYWORDS.has(value) ||
    isRawContentFunction(value)
  ) {
    return value;
  }

  return JSON.stringify(value);
}

const RAW_GRID_TEMPLATE_AREAS_KEYWORDS = new Set([
  "none",
  "inherit",
  "initial",
  "revert",
  "revert-layer",
  "unset",
]);

function formatGridTemplateAreasValue(value: string): string {
  const trimmed = value.trim();
  if (
    isQuotedCssString(trimmed) ||
    RAW_GRID_TEMPLATE_AREAS_KEYWORDS.has(trimmed) ||
    trimmed.startsWith("var(")
  ) {
    return value;
  }

  return JSON.stringify(value);
}

function formatFontVariationAxisName(axis: string): string {
  const trimmed = axis.trim();
  if (trimmed.length === 0) {
    throw new Error("fontVariationSettings axis names must not be empty.");
  }

  if (isQuotedCssString(trimmed)) {
    return trimmed;
  }

  return `'${trimmed.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function formatFontVariationCssVarRef(value: CssVarRef): string {
  if (value.fallback === undefined) {
    return `var(${value.name})`;
  }
  return `var(${value.name}, ${String(value.fallback)})`;
}

function formatFontVariationAxisValue(
  value: PrimitiveStyleValue | CssVarRef,
): string {
  if (isCssVarRef(value)) {
    return formatFontVariationCssVarRef(value);
  }
  return String(value);
}

function formatFontVariationSettingsObject(
  value: FontVariationSettingsObject,
): string {
  return Object.entries(value)
    .map(([axis, axisValue]) =>
      `${formatFontVariationAxisName(axis)} ${
        formatFontVariationAxisValue(axisValue)
      }`
    )
    .join(", ");
}

function formatFontVariationSettingsValue(
  value: FontVariationSettingsValue,
): string {
  if (isFontVariationSettingsObject(value)) {
    return formatFontVariationSettingsObject(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (isFontVariationSettingsObject(entry)) {
        return formatFontVariationSettingsObject(entry);
      }
      return String(entry);
    }).join(", ");
  }

  if (isCssVarRef(value)) {
    return formatFontVariationCssVarRef(value);
  }

  return String(value);
}

function isTransitionTimingToken(value: string): boolean {
  return (
    /^-?\d*\.?\d+m?s$/i.test(value) ||
    value === "linear" ||
    value === "step-start" ||
    value === "step-end" ||
    value.startsWith("ease") ||
    value.startsWith("steps(") ||
    value.startsWith("cubic-bezier(")
  );
}

function shouldUseSpaceDelimitedTransitionValue(
  value: readonly (PrimitiveStyleValue | CssVarRef)[],
): boolean {
  if (value.length < 2) {
    return false;
  }

  let hasTimingToken = false;
  for (const entry of value) {
    if (typeof entry === "number") {
      return false;
    }

    if (isCssVarRef(entry)) {
      hasTimingToken = true;
      continue;
    }

    if (/\s|,/.test(entry)) {
      return false;
    }

    if (isTransitionTimingToken(entry)) {
      hasTimingToken = true;
    }
  }

  return hasTimingToken;
}

function formatStyleValue(
  property: string,
  value: DeclarationStyleValue,
  options?: CssSerializationOptions,
): string {
  if (isFontVariationSettingsProperty(property)) {
    return formatFontVariationSettingsValue(value);
  }

  if (Array.isArray(value)) {
    if (
      property === "transition" && shouldUseSpaceDelimitedTransitionValue(value)
    ) {
      return value.map((entry) => formatStyleValue(property, entry, options))
        .join(" ");
    }
    const separator = COMMA_DELIMITED_PROPERTIES.has(property) ? ", " : " ";
    return value.map((entry) => formatStyleValue(property, entry, options))
      .join(separator);
  }

  if (isCssVarRef(value)) {
    if (value.fallback === undefined) {
      return `var(${value.name})`;
    }
    return `var(${value.name}, ${
      formatPrimitiveStyleValue(property, value.fallback, options)
    })`;
  }

  return formatPrimitiveStyleValue(
    property,
    value as PrimitiveStyleValue,
    options,
  );
}
