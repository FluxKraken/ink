import {
  findInkCalls,
  findNewInkDeclarations,
  parseInkBuilderOptions,
  parseInkCallArguments,
  parseInkCallArgumentsWithResolver,
  parseInkConfig,
  parseStaticExpression,
} from "./parser.js";
import runtimeInk from "./runtime.js";
import {
  camelToKebab,
  createClassName,
  cVar,
  defineCssConfig,
  defineInkConfig,
  font,
  fontsToConfig,
  isCssVarRef,
  mergeTailwindClassNames,
  rootVarsToGlobalRules,
  type StyleDeclaration,
  type StyleSheet,
  type StyleValue,
  Theme,
  ThemeAdvanced,
  type ThemeMode,
  toCssGlobalRules,
  toCssLayerOrderRule,
  toCssRules,
  tVar,
  tw,
} from "./shared.js";
import {
  type AstNewInkDeclaration,
  type AstTransformTargets,
  collectTransformTargets,
  type ImportBinding,
  type ModuleStaticInfo,
  parseModuleStaticInfo,
} from "./ast.js";

const PUBLIC_VIRTUAL_ID = "virtual:ink/styles.css";
const RESOLVED_VIRTUAL_ID = "\0virtual:ink/styles.css";
const PUBLIC_TAILWIND_RUNTIME_ID = "virtual:ink/tailwind-merge";
const RESOLVED_TAILWIND_RUNTIME_ID = "\0virtual:ink/tailwind-merge";
const MODULE_VIRTUAL_QUERY_KEY = "ink-module";
const SIMPLE_STYLE_KEY = "__ink_simple__";
const STATIC_STYLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
];
const IMAGE_ASSET_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".bmp",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".png",
  ".svg",
  ".tif",
  ".tiff",
  ".webp",
]);
const INK_CONFIG_FILENAMES = [
  "ink.config.ts",
  "ink.config.mts",
  "ink.config.js",
  "ink.config.mjs",
  "ink.config.cts",
  "ink.config.cjs",
] as const;
const PROJECT_ROOT_MARKERS = [
  ...INK_CONFIG_FILENAMES,
  "package.json",
  "deno.json",
  "tsconfig.json",
] as const;

type ViteAliasEntry = {
  find: string | RegExp;
  replacement: string;
};

type TsconfigPathMatcher = {
  pattern: string;
  prefix: string;
  suffix: string;
  hasWildcard: boolean;
  targets: string[];
};

type TsconfigPathResolver = {
  resolve: (source: string) => string | null;
};

type ViteModuleGraphLike = {
  getModuleById: (id: string) => unknown;
  getModulesByFile?: (file: string) => Set<unknown> | undefined;
  invalidateModule: (
    module: unknown,
    invalidatedModules?: Set<unknown>,
    timestamp?: number,
    isHmr?: boolean,
  ) => void;
};

type ViteDevServerLike = {
  moduleGraph: ViteModuleGraphLike;
};

type ViteResolvedConfigLike = {
  root: string;
  resolve: {
    alias?: unknown;
  };
};

type ViteTransformContextLike = {
  addWatchFile?: (id: string) => void;
  load?: (options: { id: string }) => Promise<any>;
};

type ImportResolverOptions = {
  projectRoot: string;
  viteRoot: string;
  viteAliases: readonly ViteAliasEntry[];
  tsconfigResolver: TsconfigPathResolver | null;
};

type LoadedInkConfig = {
  path: string | null;
  dependencies: string[];
  imports: string[];
  themeMode: ThemeMode;
  resolution: "static" | "dynamic" | "hybrid";
  hasExplicitResolution: boolean;
  debug: {
    logDynamic: boolean;
    logStatic: boolean;
  };
  breakpoints: Record<string, string>;
  breakpointBoundary: "inclusive" | "exclusive" | "reverse";
  containers: Record<string, { type?: string; rule: string }>;
  layers: string[];
  defaultUnit?: string;
  include: string[];
  rootLayout: string | null;
  utilities: NormalizedStyleSheet;
  configCss: string;
  utilityCss: string;
  runtimeOptions: {
    breakpoints?: Record<string, string>;
    breakpointBoundary?: "inclusive" | "exclusive" | "reverse";
    containers?: Record<string, { type?: string; rule: string }>;
    layers?: string[];
    defaultUnit?: string;
    utilities?: NormalizedStyleSheet;
    themeMode?: ThemeMode;
    resolution?: "static" | "dynamic" | "hybrid";
    debug?: {
      enabled?: boolean;
      logDynamic?: boolean;
      logStatic?: boolean;
    };
  };
};

type ResolvedStyleDefinition = {
  kind: "ink-style";
  declaration: StyleDeclaration;
  tailwindClassNames?: readonly string[];
};
type NormalizedStyleSheet = Record<string, ResolvedStyleDefinition>;

type NodeFs = typeof import("node:fs");
type NodePath = typeof import("node:path");
type NodeModule = typeof import("node:module");
type NodeRequire = (id: string) => unknown;
type NodeRequireWithResolve = NodeRequire & {
  resolve?: (id: string) => string;
};
type TypeScriptTranspileApi = {
  transpileModule: (
    source: string,
    options: {
      compilerOptions: {
        target: number;
        module: number;
      };
    },
  ) => { outputText: string };
  ScriptTarget: { ES2020: number };
  ModuleKind: { ESNext: number };
};
type TypeScriptAstApi = TypeScriptTranspileApi & {
  createSourceFile: (
    fileName: string,
    sourceText: string,
    languageVersion: number,
    setParentNodes?: boolean,
    scriptKind?: number,
  ) => unknown;
  ScriptKind: Record<string, number>;
  SyntaxKind: Record<string, number>;
  forEachChild: (node: unknown, cbNode: (node: unknown) => void) => void;
};
type SourceRegion = {
  code: string;
  id: string;
  offset: number;
};
type SvelteCompilerApi = {
  parse: (
    source: string,
    options?: { modern?: boolean; filename?: string },
  ) => unknown;
};
let nodeFs: NodeFs | null | undefined;
let nodePath: NodePath | null | undefined;
let nodeRequire: NodeRequire | null | undefined;
let typeScriptModule: TypeScriptTranspileApi | null | undefined;
let tsTranspiler: ((source: string) => string) | null | undefined;
const svelteCompilerCache = new Map<string, SvelteCompilerApi | null>();

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
    nodeRequire = moduleBuiltin.createRequire(import.meta.url) as NodeRequire;
    return nodeRequire;
  }

  nodeRequire = getFallbackRequire();
  return nodeRequire;
}

function createRequireFromPath(path: string): NodeRequire | null {
  const moduleBuiltin = getBuiltinModule("node:module") as NodeModule | null;
  if (moduleBuiltin && typeof moduleBuiltin.createRequire === "function") {
    try {
      return moduleBuiltin.createRequire(path) as NodeRequire;
    } catch {
      // fall through to the shared fallback require
    }
  }

  return getNodeRequire();
}

function isTypeScriptTranspileApi(
  value: unknown,
): value is TypeScriptTranspileApi {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<TypeScriptTranspileApi>;
  return (
    typeof candidate.transpileModule === "function" &&
    typeof candidate.ScriptTarget?.ES2020 === "number" &&
    typeof candidate.ModuleKind?.ESNext === "number"
  );
}

function loadTypeScriptModuleFromDisk(
  requireFn: NodeRequire,
): TypeScriptTranspileApi | null {
  const requireWithResolve = requireFn as NodeRequireWithResolve;
  if (typeof requireWithResolve.resolve !== "function") {
    return null;
  }

  try {
    const modulePath = requireWithResolve.resolve(
      "typescript/lib/typescript.js",
    );
    const fs = getNodeFs();
    const path = getNodePath();
    const source = fs.readFileSync(modulePath, "utf8");
    const module = { exports: {} as unknown };
    const exports = module.exports;

    // Deno's CommonJS interop can return an empty namespace for typescript; execute the CJS bundle directly instead.
    const loaded = new Function(
      "exports",
      "require",
      "module",
      "__filename",
      "__dirname",
      `${source}\nreturn module.exports;`,
    )(exports, requireFn, module, modulePath, path.dirname(modulePath));

    return isTypeScriptTranspileApi(loaded) ? loaded : null;
  } catch {
    return null;
  }
}

function loadTypeScriptModule(
  requireFn: NodeRequire,
): TypeScriptTranspileApi | null {
  try {
    const loaded = requireFn("typescript");
    if (isTypeScriptTranspileApi(loaded)) {
      return loaded;
    }

    if (
      loaded &&
      typeof loaded === "object" &&
      "default" in (loaded as Record<string, unknown>) &&
      isTypeScriptTranspileApi((loaded as Record<string, unknown>).default)
    ) {
      return (loaded as { default: TypeScriptTranspileApi }).default;
    }
  } catch {
    // fall through to the disk-backed fallback
  }

  return loadTypeScriptModuleFromDisk(requireFn);
}

function getTypeScriptModule(): TypeScriptTranspileApi | null {
  if (typeScriptModule !== undefined) {
    return typeScriptModule;
  }

  const requireFn = getNodeRequire();
  if (!requireFn) {
    typeScriptModule = null;
    return null;
  }

  typeScriptModule = loadTypeScriptModule(requireFn);
  return typeScriptModule;
}

function getTypeScriptAstApi(): TypeScriptAstApi | null {
  const typescript = getTypeScriptModule();
  if (
    !typescript ||
    typeof (typescript as Partial<TypeScriptAstApi>).createSourceFile !==
      "function" ||
    typeof (typescript as Partial<TypeScriptAstApi>).forEachChild !==
      "function" ||
    typeof typescript.ScriptTarget?.ES2020 !== "number" ||
    typeof (typescript as Partial<TypeScriptAstApi>).ScriptKind?.TSX !==
      "number" ||
    typeof (typescript as Partial<TypeScriptAstApi>).SyntaxKind
        ?.CallExpression !==
      "number"
  ) {
    return null;
  }

  return typescript as TypeScriptAstApi;
}

function parseStaticModuleInfo(code: string, id: string): ModuleStaticInfo {
  return parseModuleStaticInfo(code, id, getTypeScriptAstApi());
}

function getNodeFs(): NodeFs {
  if (nodeFs) {
    return nodeFs;
  }

  const builtin = getBuiltinModule("node:fs") as NodeFs | null;
  if (builtin) {
    nodeFs = builtin;
    return nodeFs;
  }

  const requireFn = getNodeRequire();
  if (requireFn) {
    nodeFs = requireFn("node:fs") as NodeFs;
    return nodeFs;
  }

  throw new Error("ink vite plugin requires Node.js built-ins (node:fs).");
}

function getNodePath(): NodePath {
  if (nodePath) {
    return nodePath;
  }

  const builtin = getBuiltinModule("node:path") as NodePath | null;
  if (builtin) {
    nodePath = builtin;
    return nodePath;
  }

  const requireFn = getNodeRequire();
  if (requireFn) {
    nodePath = requireFn("node:path") as NodePath;
    return nodePath;
  }

  throw new Error("ink vite plugin requires Node.js built-ins (node:path).");
}

function resolveTailwindSharedModuleUrl(): string {
  const candidates = [
    new URL("./shared.js", import.meta.url),
    new URL("./shared.ts", import.meta.url),
  ];

  for (const candidate of candidates) {
    if (candidate.protocol !== "file:") {
      return candidate.href;
    }

    let pathName = decodeURIComponent(candidate.pathname);
    if (/^\/[A-Za-z]:\//.test(pathName)) {
      pathName = pathName.slice(1);
    }

    if (getNodeFs().existsSync(pathName)) {
      return candidate.href;
    }
  }

  return candidates[0].href;
}

// Keep this helper inline so JSR's npm wrapper does not rewrite the
// `tailwind-merge` import into a missing local file path.
function loadTailwindRuntimeModule(): string {
  return `import { twMerge } from "tailwind-merge";
import { setTailwindMerge } from ${
    JSON.stringify(resolveTailwindSharedModuleUrl())
  };
setTailwindMerge(twMerge);
export {};
`;
}

const STATIC_EVAL_GLOBALS: Record<string, unknown> = {
  Array,
  Boolean,
  Infinity,
  JSON,
  Math,
  NaN,
  Number,
  Object,
  String,
  isFinite,
  isNaN,
  parseFloat,
  parseInt,
  undefined,
};

function cleanId(id: string): string {
  return id.replace(/\?.*$/, "");
}

function supportsTransform(id: string): boolean {
  return /\.(?:[jt]sx?|svelte|astro)$/.test(cleanId(id));
}

const INK_IMPORT_SOURCES = [
  "@kraken/ink",
  "@jsr/kraken__ink",
] as const;
let staticInkDefaultExport: Record<string, unknown> | null = null;

function isInkImportSource(source: string): boolean {
  return (INK_IMPORT_SOURCES as readonly string[]).includes(source);
}

function getStaticInkDefaultExport(): Record<string, unknown> {
  if (staticInkDefaultExport) {
    return staticInkDefaultExport;
  }

  const callable = function (
    ...args: unknown[]
  ): unknown {
    return (runtimeInk as (...args: unknown[]) => unknown)(...args);
  };
  Object.defineProperty(callable, "prototype", {
    value: (runtimeInk as unknown as { prototype: unknown }).prototype,
  });

  staticInkDefaultExport = Object.assign(
    callable as unknown as Record<string, unknown>,
    {
      vite: inkVite,
      cVar,
      defineCssConfig,
      defineInkConfig,
      font,
      Theme,
      ThemeAdvanced,
      tw,
      tVar,
    },
  );
  return staticInkDefaultExport;
}

function getStaticInkNamespace(): Record<string, unknown> {
  return {
    default: getStaticInkDefaultExport(),
    vite: inkVite,
    cVar,
    defineCssConfig,
    defineInkConfig,
    font,
    Theme,
    ThemeAdvanced,
    tw,
    tVar,
  };
}

function resolveStaticInkImport(
  binding: ImportBinding,
  tail: readonly string[],
): unknown | null {
  if (!isInkImportSource(binding.source)) {
    return null;
  }

  if (binding.kind === "namespace") {
    const namespaceValue = getStaticInkNamespace();
    return tail.length > 0
      ? readMemberPath(namespaceValue, tail)
      : namespaceValue;
  }

  const importedValue = binding.kind === "default"
    ? getStaticInkDefaultExport()
    : getStaticInkNamespace()[binding.imported];

  if (importedValue === undefined) {
    return null;
  }

  return tail.length > 0 ? readMemberPath(importedValue, tail) : importedValue;
}

function isVirtualSubRequest(id: string): boolean {
  return id.includes("?");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendConfigImportPath(
  global: Record<string, unknown>,
  entry: string | Record<string, unknown>,
): void {
  const current = global["@import"];
  if (Array.isArray(current)) {
    current.push(entry);
    return;
  }
  global["@import"] = current === undefined ? [entry] : [current, entry];
}

function importEntriesFromConfigInput(input: unknown): unknown[] | null {
  if (typeof input === "string" || isRecord(input)) {
    return [input];
  }
  if (Array.isArray(input)) {
    return input;
  }
  return null;
}

function parseConfigImportInput(
  input: unknown,
  options: { containers: Record<string, { type?: string; rule: string }> },
): ReturnType<typeof parseInkConfig> {
  const entries = importEntriesFromConfigInput(input);
  if (!entries) {
    return null;
  }

  const global: Record<string, unknown> = {};
  const tailwindConfigs: unknown[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      appendConfigImportPath(global, entry);
      continue;
    }

    if (!isRecord(entry)) {
      return null;
    }

    if ("tailwind" in entry) {
      tailwindConfigs.push(entry.tailwind);
      continue;
    }

    if ("path" in entry) {
      appendConfigImportPath(global, entry);
      continue;
    }

    if ("rules" in entry) {
      const layer = typeof entry.layer === "string" ? entry.layer.trim() : "";
      if (layer.length > 0) {
        global[`@layer ${layer}`] = entry.rules;
      } else if (isRecord(entry.rules)) {
        Object.assign(global, entry.rules);
      } else {
        return null;
      }
      continue;
    }

    Object.assign(global, entry);
  }

  const configParts: Record<string, unknown> = {};
  if (Object.keys(global).length > 0) {
    configParts.global = global;
  }
  if (tailwindConfigs.length === 1) {
    configParts.tailwind = tailwindConfigs[0];
  } else if (tailwindConfigs.length > 1) {
    configParts.tailwind = tailwindConfigs;
  }

  return Object.keys(configParts).length > 0
    ? parseInkConfig(configParts, options)
    : null;
}

function readMemberPath(
  value: unknown,
  members: readonly string[],
): unknown | null {
  let current: unknown = value;
  for (const member of members) {
    if (
      typeof current !== "object" || current === null || Array.isArray(current)
    ) {
      return null;
    }
    const record = current as Record<string, unknown>;
    if (!(member in record)) {
      return null;
    }
    current = record[member];
  }
  return current;
}

function findMatchingBrace(input: string, openIndex: number): number {
  let depth = 0;

  for (let i = openIndex; i < input.length; i += 1) {
    const char = input[i];
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }

  return -1;
}

function toSvelteGlobalRule(rule: string): string {
  const open = rule.indexOf("{");
  if (open === -1) return rule;

  const close = findMatchingBrace(rule, open);
  if (close === -1) return rule;

  const head = rule.slice(0, open).trim();
  const body = rule.slice(open + 1, close);
  const suffix = rule.slice(close + 1).trim();

  const next = head.startsWith("@")
    ? `${head}{${toSvelteGlobalRule(body)}}`
    : `:global(${head}){${body}}`;

  if (suffix.length === 0) {
    return next;
  }
  return `${next}${suffix}`;
}

function addSvelteStyleBlock(code: string, rules: Iterable<string>): string {
  const css = Array.from(rules).map(toSvelteGlobalRule).join("\n");

  if (!css) {
    return code;
  }

  const styleOpenMatch = code.match(/<style\b[^>]*>/);
  if (styleOpenMatch && styleOpenMatch.index !== undefined) {
    const styleOpenEnd = styleOpenMatch.index + styleOpenMatch[0].length;
    const styleCloseIndex = code.indexOf("</style>", styleOpenEnd);
    if (styleCloseIndex !== -1) {
      const needsLeadingNewline = !code.slice(0, styleCloseIndex).endsWith(
        "\n",
      );
      const cssPrefix = needsLeadingNewline ? "\n" : "";
      return code.slice(0, styleCloseIndex) +
        `${cssPrefix}${css}\n` +
        code.slice(styleCloseIndex);
    }
  }

  return `${code}\n<style>\n${css}\n</style>\n`;
}

function addVirtualImport(code: string, importId = PUBLIC_VIRTUAL_ID): string {
  if (code.includes(importId)) {
    return code;
  }

  return `import "${importId}";\n${code}`;
}

function addVirtualImportToSvelte(
  code: string,
  importId = PUBLIC_VIRTUAL_ID,
): string {
  if (code.includes(importId)) {
    return code;
  }

  const match = code.match(/<script\b[^>]*>/);
  if (!match || match.index === undefined) {
    return `<script>\nimport "${importId}";\n</script>\n${code}`;
  }

  const insertAt = match.index + match[0].length;
  return (
    code.slice(0, insertAt) +
    `\nimport "${importId}";` +
    code.slice(insertAt)
  );
}

function addVirtualImportToAstro(
  code: string,
  importId = PUBLIC_VIRTUAL_ID,
): string {
  if (code.includes(importId)) {
    return code;
  }

  const frontmatterMatch = code.match(/^---[ \t]*\r?\n/);
  if (frontmatterMatch) {
    const insertAt = frontmatterMatch[0].length;
    return (
      code.slice(0, insertAt) +
      `import "${importId}";\n` +
      code.slice(insertAt)
    );
  }

  const trimmed = code.trimStart();
  if (/^(?:import|export|const|let|var|function|class)\b/.test(trimmed)) {
    return addVirtualImport(code, importId);
  }

  return `---\nimport "${importId}";\n---\n${code}`;
}

function addVirtualImportToModule(
  code: string,
  options: { isSvelte: boolean; isAstro: boolean },
  importId = PUBLIC_VIRTUAL_ID,
): string {
  if (options.isSvelte) {
    return addVirtualImportToSvelte(code, importId);
  }
  if (options.isAstro) {
    return addVirtualImportToAstro(code, importId);
  }
  return addVirtualImport(code, importId);
}

function addModuleVirtualImportToAstro(code: string, importId: string): string {
  if (code.includes(importId)) {
    return code;
  }

  const frontmatterMatch = code.match(/^---[ \t]*\r?\n/);
  if (!frontmatterMatch) {
    return `${code}\nimport "${importId}";\n`;
  }

  const frontmatterBody = code.slice(frontmatterMatch[0].length);
  const closeMatch = frontmatterBody.match(/\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!closeMatch || closeMatch.index === undefined) {
    return `${code}\nimport "${importId}";\n`;
  }

  const insertAt = frontmatterMatch[0].length + closeMatch.index;
  return code.slice(0, insertAt) + `\nimport "${importId}";` +
    code.slice(insertAt);
}

function loadProjectSvelteCompiler(
  projectRoot: string,
  viteRoot: string,
): SvelteCompilerApi | null {
  const cacheKey = `${projectRoot}\0${viteRoot}`;
  if (svelteCompilerCache.has(cacheKey)) {
    return svelteCompilerCache.get(cacheKey) ?? null;
  }

  const roots = Array.from(new Set([projectRoot, viteRoot]));
  for (const root of roots) {
    const packageJsonPath = getNodePath().join(root, "package.json");
    const requireBase = getNodeFs().existsSync(packageJsonPath)
      ? packageJsonPath
      : getNodePath().join(root, "noop.js");
    const requireFn = createRequireFromPath(requireBase);
    if (!requireFn) {
      continue;
    }

    try {
      const loaded = requireFn("svelte/compiler") as {
        parse?: unknown;
        default?: unknown;
      };
      const candidate = typeof loaded?.parse === "function"
        ? loaded
        : loaded?.default;
      if (
        candidate && typeof candidate === "object" &&
        typeof (candidate as { parse?: unknown }).parse === "function"
      ) {
        const compiler = candidate as SvelteCompilerApi;
        svelteCompilerCache.set(cacheKey, compiler);
        return compiler;
      }
    } catch {
      // Svelte is optional; the local extractor below handles this path.
    }
  }

  svelteCompilerCache.set(cacheKey, null);
  return null;
}

function readSvelteContentRegion(
  ast: unknown,
  key: "module" | "instance",
  code: string,
  id: string,
): SourceRegion | null {
  const section = (ast as Record<string, unknown> | null)?.[key] as {
    content?: unknown;
  } | null;
  const content = section?.content as {
    start?: unknown;
    end?: unknown;
  } | null;
  if (
    !content ||
    typeof content.start !== "number" ||
    typeof content.end !== "number" ||
    content.start > content.end
  ) {
    return null;
  }

  return {
    code: code.slice(content.start, content.end),
    id: `${id}?ink-script=${key}`,
    offset: content.start,
  };
}

function extractSvelteScriptRegionsFallback(
  code: string,
  id: string,
): SourceRegion[] {
  const regions: SourceRegion[] = [];
  const matcher = /<script\b[^>]*>/gi;
  for (let match = matcher.exec(code); match; match = matcher.exec(code)) {
    const start = match.index + match[0].length;
    const close = code.toLowerCase().indexOf("</script>", start);
    if (close === -1) {
      break;
    }
    regions.push({
      code: code.slice(start, close),
      id: `${id}?ink-script=${regions.length}`,
      offset: start,
    });
    matcher.lastIndex = close + "</script>".length;
  }
  return regions;
}

function extractSvelteScriptRegions(
  code: string,
  id: string,
  projectRoot: string,
  viteRoot: string,
): SourceRegion[] {
  const compiler = loadProjectSvelteCompiler(projectRoot, viteRoot);
  if (compiler) {
    try {
      const ast = compiler.parse(code, { modern: true, filename: id });
      const regions = [
        readSvelteContentRegion(ast, "module", code, id),
        readSvelteContentRegion(ast, "instance", code, id),
      ].filter((region): region is SourceRegion => region !== null)
        .sort((a, b) => a.offset - b.offset);
      if (regions.length > 0) {
        return regions;
      }
    } catch {
      // Fall back to the local extractor if the optional compiler cannot parse.
    }
  }

  return extractSvelteScriptRegionsFallback(code, id);
}

function extractAstroFrontmatterRegion(
  code: string,
  id: string,
): SourceRegion | null {
  const opening = code.match(/^\uFEFF?---[ \t]*(?:\r?\n|$)/);
  if (!opening) {
    return null;
  }

  const start = opening[0].length;
  const closeMatcher = /^---[ \t]*(?:\r?\n|$)/gm;
  closeMatcher.lastIndex = start;
  const close = closeMatcher.exec(code);
  if (!close) {
    return null;
  }

  return {
    code: code.slice(start, close.index),
    id: `${id}?ink-frontmatter`,
    offset: start,
  };
}

function isJsShapedAstroInput(code: string): boolean {
  return /^(?:import|export|const|let|var|function|async\s+function|class)\b/
    .test(code.trimStart());
}

function extractTransformSourceRegions(
  code: string,
  id: string,
  options: {
    isSvelte: boolean;
    isAstro: boolean;
    projectRoot: string;
    viteRoot: string;
  },
): SourceRegion[] {
  if (options.isSvelte) {
    const scripts = extractSvelteScriptRegions(
      code,
      id,
      options.projectRoot,
      options.viteRoot,
    );
    return scripts.length > 0 || !isJsShapedAstroInput(code)
      ? scripts
      : [{ code, id, offset: 0 }];
  }

  if (options.isAstro) {
    const frontmatter = extractAstroFrontmatterRegion(code, id);
    if (frontmatter) {
      return [frontmatter];
    }
    return isJsShapedAstroInput(code) ? [{ code, id, offset: 0 }] : [];
  }

  return [{ code, id, offset: 0 }];
}

function mergeSourceRegions(regions: readonly SourceRegion[]): string {
  return regions.map((region) => region.code).join("\n");
}

function collectTransformTargetsFromRegions(
  regions: readonly SourceRegion[],
): AstTransformTargets | null {
  const typescript = getTypeScriptAstApi();
  if (!typescript) {
    return null;
  }

  const calls: AstTransformTargets["calls"] = [];
  const newInkDecls: AstTransformTargets["newInkDecls"] = [];
  for (const region of regions) {
    const targets = collectTransformTargets({
      typescript,
      code: region.code,
      id: region.id,
      offset: region.offset,
      inkImportSources: INK_IMPORT_SOURCES,
    });
    if (!targets) {
      return null;
    }
    calls.push(...targets.calls);
    newInkDecls.push(...targets.newInkDecls);
  }

  return { calls, newInkDecls };
}

function collectLegacyTransformTargetsFromRegions(
  regions: readonly SourceRegion[],
): AstTransformTargets {
  const newInkDecls: AstNewInkDeclaration[] = [];
  for (const region of regions) {
    const offset = region.offset;
    for (const decl of findNewInkDeclarations(region.code)) {
      newInkDecls.push({
        varName: decl.varName,
        start: decl.start + offset,
        initializerStart: decl.initializerStart + offset,
        initializerEnd: decl.initializerEnd + offset,
        constructorSource: "ink",
        optionsSource: decl.optionsSource,
        hasStaticOptions: decl.hasStaticOptions,
        simple: decl.simple,
        hasAddContainerCall: new RegExp(
          `\\b${decl.varName}\\.addContainer\\s*\\(`,
        ).test(region.code),
        assignments: decl.assignments.map((assignment) => ({
          property: assignment.property,
          start: assignment.start + offset,
          end: assignment.end + offset,
          valueSource: assignment.valueSource,
        })),
      });
    }
  }

  const calls = regions.flatMap((region) =>
    findInkCalls(region.code).map((call) => ({
      start: call.start + region.offset,
      end: call.end + region.offset,
      callee: "ink",
      arg: call.arg,
    }))
  ).filter((call) =>
    !newInkDecls.some((decl) =>
      call.start >= decl.initializerStart && call.end <= decl.initializerEnd
    )
  );

  return { calls, newInkDecls };
}

function moduleVirtualImportId(moduleId: string): string {
  return `${PUBLIC_VIRTUAL_ID}?${MODULE_VIRTUAL_QUERY_KEY}=${
    encodeURIComponent(moduleId)
  }`;
}

function resolvedModuleVirtualId(moduleId: string): string {
  return `${RESOLVED_VIRTUAL_ID}?${MODULE_VIRTUAL_QUERY_KEY}=${
    encodeURIComponent(moduleId)
  }`;
}

function readModuleVirtualImportId(id: string): string | null {
  const queryIndex = id.indexOf("?");
  if (queryIndex === -1) {
    return null;
  }

  const params = new URLSearchParams(id.slice(queryIndex + 1));
  const moduleId = params.get(MODULE_VIRTUAL_QUERY_KEY);
  return moduleId && moduleId.length > 0 ? moduleId : null;
}

function mergeCss(rules: Iterable<string>): string {
  return Array.from(rules).join("\n");
}

function findFileUpwards(
  startDir: string,
  candidates: readonly string[],
): string | null {
  let currentDir = getNodePath().resolve(startDir);

  while (true) {
    for (const candidate of candidates) {
      const fullPath = getNodePath().resolve(currentDir, candidate);
      if (
        getNodeFs().existsSync(fullPath) &&
        getNodeFs().statSync(fullPath).isFile()
      ) {
        return fullPath;
      }
    }

    const parentDir = getNodePath().dirname(currentDir);
    if (parentDir === currentDir) {
      return null;
    }
    currentDir = parentDir;
  }
}

function findCssConfigPath(searchStart: string): string | null {
  return findFileUpwards(searchStart, INK_CONFIG_FILENAMES);
}

function findProjectRoot(searchStart: string): string {
  const markerPath = findFileUpwards(searchStart, PROJECT_ROOT_MARKERS);
  return markerPath
    ? getNodePath().dirname(markerPath)
    : getNodePath().resolve(searchStart);
}

function findTsconfigPath(searchStart: string): string | null {
  return findFileUpwards(searchStart, ["tsconfig.json"]);
}

function normalizeBreakpoints(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      normalized[name] = raw;
      continue;
    }
    if (typeof raw === "number") {
      normalized[name] = `${raw}px`;
    }
  }
  return normalized;
}

function normalizeBreakpointBoundary(value: unknown):
  | "inclusive"
  | "exclusive"
  | "reverse" {
  if (value === "exclusive" || value === "reverse") {
    return value;
  }

  return "inclusive";
}

function normalizeDefaultUnit(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeLayers(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }

    const trimmed = entry.trim();
    if (trimmed.length === 0 || seen.has(trimmed)) {
      continue;
    }

    seen.add(trimmed);
    normalized.push(trimmed);
  }

  return normalized;
}

function normalizeContainers(
  value: unknown,
): Record<string, { type?: string; rule: string }> {
  const normalized: Record<string, { type?: string; rule: string }> = {};

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isRecord(entry)) {
        continue;
      }
      const name = entry.name;
      const rule = entry.rule;
      if (typeof name !== "string" || typeof rule !== "string") {
        continue;
      }
      const type = typeof entry.type === "string" ? entry.type : undefined;
      normalized[name] = type ? { type, rule } : { rule };
    }
    return normalized;
  }

  if (!isRecord(value)) {
    return normalized;
  }

  for (const [name, raw] of Object.entries(value)) {
    if (!isRecord(raw) || typeof raw.rule !== "string") {
      continue;
    }
    const type = typeof raw.type === "string" ? raw.type : undefined;
    normalized[name] = type ? { type, rule: raw.rule } : { rule: raw.rule };
  }

  return normalized;
}

function normalizeResolution(value: unknown): "static" | "dynamic" | "hybrid" {
  if (value === "static" || value === "dynamic" || value === "hybrid") {
    return value;
  }
  return "hybrid";
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "scope" || value === "color-scheme" || value === "custom"
    ? value
    : "color-scheme";
}

function normalizeDebugOptions(
  value: unknown,
): { logDynamic: boolean; logStatic: boolean } {
  if (!isRecord(value)) {
    return {
      logDynamic: false,
      logStatic: false,
    };
  }

  return {
    logDynamic: value.logDynamic === true,
    logStatic: value.logStatic === true,
  };
}

function normalizeIncludePaths(value: unknown, baseDir: string): string[] {
  const entries = typeof value === "string"
    ? [value]
    : Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];

  const normalized = entries
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) =>
      getNodePath().normalize(
        getNodePath().isAbsolute(entry)
          ? entry
          : getNodePath().resolve(baseDir, entry),
      )
    );

  return Array.from(new Set(normalized));
}

function normalizeRootLayoutPath(value: unknown, baseDir: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return getNodePath().normalize(
    getNodePath().isAbsolute(trimmed)
      ? trimmed
      : getNodePath().resolve(baseDir, trimmed),
  );
}

function toBrowserStylesheetPath(
  importPath: string,
  importerPath: string,
  options: ImportResolverOptions,
): string | null {
  const match = importPath.match(/^"([^"]+)"(.*)$/);
  const bareImportPathRaw = match ? match[1] : importPath;
  const suffix = match ? match[2] : "";

  const queryIndex = bareImportPathRaw.indexOf("?");
  const bareImportPath = queryIndex === -1
    ? bareImportPathRaw
    : bareImportPathRaw.slice(0, queryIndex);
  const querySuffix = queryIndex === -1
    ? ""
    : bareImportPathRaw.slice(queryIndex);

  const formatResult = (resolvedValue: string | null): string | null => {
    if (!resolvedValue) return null;
    return match ? `"${resolvedValue}"${suffix}` : resolvedValue;
  };

  const toProjectPath = (resolvedFile: string): string | null => {
    const relative = getNodePath().relative(options.viteRoot, resolvedFile)
      .split(getNodePath().sep).join("/");
    if (relative.startsWith("..")) {
      return null;
    }
    return `/${relative}${querySuffix}`;
  };

  if (
    /^(?:https?:)?\/\//.test(bareImportPath) ||
    bareImportPath.startsWith("data:")
  ) {
    return formatResult(bareImportPathRaw);
  }
  if (bareImportPath.startsWith("/")) {
    return formatResult(bareImportPathRaw);
  }

  if (bareImportPath.startsWith(".")) {
    const resolved = resolveFileFromBase(
      getNodePath().resolve(
        getNodePath().dirname(importerPath),
        bareImportPath,
      ),
    );
    if (resolved) {
      return formatResult(toProjectPath(resolved));
    }

    const fallback = getNodePath().resolve(
      getNodePath().dirname(importerPath),
      bareImportPath,
    );
    return formatResult(toProjectPath(fallback));
  }

  const resolved = resolveImportToFile(importerPath, bareImportPath, options);
  if (resolved) {
    const projectPath = toProjectPath(resolved);
    if (projectPath) {
      return formatResult(projectPath);
    }
  }

  return formatResult(bareImportPathRaw);
}

function stripQueryAndHash(value: string): string {
  const queryIndex = value.indexOf("?");
  const hashIndex = value.indexOf("#");
  const endIndex = queryIndex === -1
    ? hashIndex
    : hashIndex === -1
    ? queryIndex
    : Math.min(queryIndex, hashIndex);
  return endIndex === -1 ? value : value.slice(0, endIndex);
}

function hasRawAssetQuery(value: string): boolean {
  const queryIndex = value.indexOf("?");
  if (queryIndex === -1) {
    return false;
  }

  const hashIndex = value.indexOf("#", queryIndex);
  const query = value.slice(
    queryIndex + 1,
    hashIndex === -1 ? undefined : hashIndex,
  );
  return query.split("&").some((part) => part === "raw");
}

function isDefaultLikeImport(binding: ImportBinding): boolean {
  return binding.kind === "default" ||
    (binding.kind === "named" && binding.imported === "default");
}

function isImageAssetImportPath(value: string): boolean {
  if (hasRawAssetQuery(value)) {
    return false;
  }

  const normalized = stripQueryAndHash(value).toLowerCase();
  return IMAGE_ASSET_EXTENSIONS.has(getNodePath().extname(normalized));
}

function isImageAssetFilePath(value: string): boolean {
  return IMAGE_ASSET_EXTENSIONS.has(getNodePath().extname(value).toLowerCase());
}

function resolveStaticImageImport(
  binding: ImportBinding,
  tail: readonly string[],
  importerPath: string,
  resolvedImportFile: string | null,
  options: ImportResolverOptions,
): string | null {
  if (tail.length > 0 || !isDefaultLikeImport(binding)) {
    return null;
  }

  if (
    !isImageAssetImportPath(binding.source) &&
    !(resolvedImportFile && isImageAssetFilePath(resolvedImportFile))
  ) {
    return null;
  }

  return toBrowserStylesheetPath(binding.source, importerPath, options);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function identifierMentioned(
  source: string | undefined,
  identifier: string,
): boolean {
  if (!source || source.trim().length === 0) {
    return true;
  }
  return new RegExp(`\\b${escapeRegExp(identifier)}\\b`).test(source);
}

function countIdentifierMentions(source: string, identifier: string): number {
  const matcher = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, "g");
  let count = 0;
  for (let match = matcher.exec(source); match; match = matcher.exec(source)) {
    count += 1;
  }
  return count;
}

function containsIdentifierReference(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (
    "kind" in value &&
    (value as { kind?: unknown }).kind === "identifier-ref" &&
    "path" in value &&
    Array.isArray((value as { path?: unknown }).path)
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsIdentifierReference(entry));
  }

  return Object.values(value as Record<string, unknown>).some((entry) =>
    containsIdentifierReference(entry)
  );
}

type StaticModuleResolver = {
  getModuleInfo: (moduleId: string) => ModuleStaticInfo | null;
  resolveIdentifierInModule: (
    identifierPath: readonly string[],
    moduleId: string,
  ) => unknown | null;
  buildEvalScope: (
    moduleId: string,
    excludeName?: string,
    sourceHint?: string,
  ) => Record<string, unknown>;
};

function createStaticModuleResolver(options: {
  moduleInfoCache?: Map<string, ModuleStaticInfo>;
  loadModuleCode: (moduleId: string) => string | null;
  resolveImportFile: (moduleId: string, source: string) => string | null;
  resolveRuntimeImport: (
    binding: ImportBinding,
    tail: readonly string[],
  ) => unknown | null;
  resolveAssetImport: (
    binding: ImportBinding,
    tail: readonly string[],
    moduleId: string,
    resolvedImportFile: string | null,
  ) => unknown | null;
  resolveExtra?: (
    identifierPath: readonly string[],
    moduleId: string,
  ) => unknown | null;
}): StaticModuleResolver {
  const moduleInfoCache = options.moduleInfoCache ?? new Map();
  const constValueCache = new Map<string, unknown | null>();
  const resolving = new Set<string>();

  function getModuleInfo(moduleId: string): ModuleStaticInfo | null {
    const cached = moduleInfoCache.get(moduleId);
    if (cached) {
      return cached;
    }
    const moduleCode = options.loadModuleCode(moduleId);
    if (!moduleCode) {
      return null;
    }
    const parsed = parseStaticModuleInfo(moduleCode, moduleId);
    moduleInfoCache.set(moduleId, parsed);
    return parsed;
  }

  function buildEvalScope(
    moduleId: string,
    excludeName?: string,
    sourceHint?: string,
  ): Record<string, unknown> {
    const evalScope: Record<string, unknown> = {
      ...STATIC_EVAL_GLOBALS,
    };
    const moduleInfo = getModuleInfo(moduleId);
    if (!moduleInfo) {
      return evalScope;
    }

    for (const localName of moduleInfo.functionDeclarations.keys()) {
      if (
        localName === excludeName || !identifierMentioned(sourceHint, localName)
      ) {
        continue;
      }
      const localValue = resolveIdentifierInModule([localName], moduleId);
      if (localValue !== null) {
        evalScope[localName] = localValue;
      }
    }

    for (const localName of moduleInfo.constInitializers.keys()) {
      if (
        localName === excludeName || !identifierMentioned(sourceHint, localName)
      ) {
        continue;
      }
      const localValue = resolveIdentifierInModule([localName], moduleId);
      if (localValue !== null) {
        evalScope[localName] = localValue;
      }
    }

    for (const localName of moduleInfo.imports.keys()) {
      if (!identifierMentioned(sourceHint, localName)) {
        continue;
      }
      const localValue = resolveIdentifierInModule([localName], moduleId);
      if (localValue !== null) {
        evalScope[localName] = localValue;
      }
    }

    return evalScope;
  }

  function resolveIdentifierInModule(
    identifierPath: readonly string[],
    moduleId: string,
  ): unknown | null {
    if (identifierPath.length === 0) {
      return null;
    }

    const extraValue = options.resolveExtra?.(identifierPath, moduleId) ?? null;
    if (extraValue !== null) {
      return extraValue;
    }

    const cacheKey = `${moduleId}::${identifierPath.join(".")}`;
    if (constValueCache.has(cacheKey)) {
      return constValueCache.get(cacheKey) ?? null;
    }
    if (resolving.has(cacheKey)) {
      return null;
    }

    resolving.add(cacheKey);
    let resolved: unknown | null = null;
    const [head, ...tail] = identifierPath;

    const moduleInfo = getModuleInfo(moduleId);
    if (moduleInfo) {
      const initializerInfo = moduleInfo.constInitializers.get(head);
      if (initializerInfo !== undefined) {
        const initializer = initializerInfo.initializer;
        let value = parseStaticExpression(initializer, (nestedPath) => {
          const nested = resolveIdentifierInModule(nestedPath, moduleId);
          return nested === null ? undefined : nested;
        }, { keepUnresolvedIdentifiers: true });

        if (value === null) {
          value = evaluateExpression(
            initializer,
            buildEvalScope(moduleId, head, initializer),
          );
        }

        if (value !== null) {
          resolved = tail.length > 0 ? readMemberPath(value, tail) : value;
        }
      } else {
        const functionDeclaration = moduleInfo.functionDeclarations.get(head);
        if (functionDeclaration !== undefined) {
          const functionValue = evaluateFunctionDeclaration(
            functionDeclaration,
            buildEvalScope(moduleId, head, functionDeclaration),
          );
          if (functionValue !== null) {
            resolved = tail.length > 0
              ? readMemberPath(functionValue, tail)
              : functionValue;
          }
        }
      }

      if (resolved === null) {
        const binding = moduleInfo.imports.get(head);
        if (binding) {
          resolved = options.resolveRuntimeImport(binding, tail);
          if (resolved === null) {
            const resolvedImportFile = options.resolveImportFile(
              moduleId,
              binding.source,
            );
            resolved = options.resolveAssetImport(
              binding,
              tail,
              moduleId,
              resolvedImportFile,
            );
            if (resolved === null && resolvedImportFile) {
              const importedModuleInfo = getModuleInfo(resolvedImportFile);
              if (importedModuleInfo) {
                if (binding.kind === "namespace") {
                  if (tail.length > 0) {
                    const [namespaceExport, ...namespaceTail] = tail;
                    const exportedLocalName =
                      importedModuleInfo.exportedConsts.get(namespaceExport) ??
                        namespaceExport;
                    const namespaceValue = resolveIdentifierInModule(
                      [exportedLocalName],
                      resolvedImportFile,
                    );
                    resolved = namespaceTail.length > 0
                      ? readMemberPath(namespaceValue, namespaceTail)
                      : namespaceValue;
                  }
                } else {
                  const importedName = binding.kind === "default"
                    ? "default"
                    : binding.imported;
                  const exportedLocalName = importedName === "default"
                    ? null
                    : (importedModuleInfo.exportedConsts.get(importedName) ??
                      importedName);
                  const importedValue = resolveIdentifierInModule(
                    exportedLocalName ? [exportedLocalName] : ["default"],
                    resolvedImportFile,
                  );
                  resolved = tail.length > 0
                    ? readMemberPath(importedValue, tail)
                    : importedValue;
                }
              }
            }
          }
        }
      }

      if (
        resolved === null && head === "default" &&
        moduleInfo.defaultExportExpression
      ) {
        const parsedDefault = parseStaticExpression(
          moduleInfo.defaultExportExpression,
          (nestedPath) =>
            resolveIdentifierInModule(nestedPath, moduleId) ?? undefined,
        );
        if (parsedDefault !== null) {
          resolved = tail.length > 0
            ? readMemberPath(parsedDefault, tail)
            : parsedDefault;
        } else {
          const evaluatedDefault = evaluateExpression(
            moduleInfo.defaultExportExpression,
            buildEvalScope(
              moduleId,
              undefined,
              moduleInfo.defaultExportExpression,
            ),
          );
          if (evaluatedDefault !== null) {
            resolved = tail.length > 0
              ? readMemberPath(evaluatedDefault, tail)
              : evaluatedDefault;
          }
        }
      }
    }

    resolving.delete(cacheKey);
    if (resolved !== null) {
      constValueCache.set(cacheKey, resolved);
    } else {
      constValueCache.delete(cacheKey);
    }
    return resolved;
  }

  return {
    getModuleInfo,
    resolveIdentifierInModule,
    buildEvalScope,
  };
}

function stripUnusedStaticHelperConsts(code: string, id: string): string {
  const moduleInfo = parseStaticModuleInfo(code, id);
  const removals: Array<{ start: number; end: number }> = [];

  for (const [name, info] of moduleInfo.constInitializers) {
    if (info.exported) {
      continue;
    }

    const parsedInitializer = parseStaticExpression(
      info.initializer,
      undefined,
      { keepUnresolvedIdentifiers: true },
    );
    if (
      parsedInitializer === null ||
      !containsIdentifierReference(parsedInitializer)
    ) {
      continue;
    }

    if (countIdentifierMentions(code, name) <= 1) {
      removals.push({ start: info.start, end: info.end });
    }
  }

  if (removals.length === 0) {
    return code;
  }

  removals.sort((a, b) => b.start - a.start);
  let nextCode = code;
  for (const removal of removals) {
    nextCode = nextCode.slice(0, removal.start) + nextCode.slice(removal.end);
  }
  return nextCode;
}

function hasStyleDeclarations(declaration: StyleDeclaration): boolean {
  for (const value of Object.values(declaration)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      Array.isArray(value) ||
      isCssVarRef(value)
    ) {
      return true;
    }
    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      hasStyleDeclarations(value as StyleDeclaration)
    ) {
      return true;
    }
  }
  return false;
}

function hasTailwindClassNames(style: ResolvedStyleDefinition): boolean {
  return (style.tailwindClassNames?.length ?? 0) > 0;
}

function resolveStyleClassValue(
  generatedClassName: string | undefined,
  style: ResolvedStyleDefinition,
): string {
  if (hasTailwindClassNames(style)) {
    return mergeTailwindClassNames([
      ...(generatedClassName ? [generatedClassName] : []),
      ...(style.tailwindClassNames ?? []),
    ]);
  }

  return generatedClassName ?? "";
}

function toRuntimeInkConfigLiteral(parsed: {
  simple?: boolean;
  global?: StyleSheet;
  root?: Array<
    Record<string, StyleValue> | {
      vars: Record<string, StyleValue>;
      layer?: string;
    }
  >;
  rootVars?: Array<
    Record<string, StyleValue> | {
      vars: Record<string, StyleValue>;
      layer?: string;
    }
  >;
  base: NormalizedStyleSheet;
  variant?: Record<string, Record<string, NormalizedStyleSheet>>;
  variantGlobal?: Record<string, Record<string, StyleSheet>>;
  defaults?: Record<string, string | boolean>;
}): string {
  const runtimeConfig: Record<string, unknown> = {};

  if (parsed.simple) {
    runtimeConfig.simple = true;
    runtimeConfig.base = parsed.base[SIMPLE_STYLE_KEY];
  } else {
    runtimeConfig.base = parsed.base;
  }

  if (parsed.global && Object.keys(parsed.global).length > 0) {
    runtimeConfig.global = parsed.global;
  }
  if (parsed.root && parsed.root.length > 0) {
    runtimeConfig.root = parsed.root;
  } else if (parsed.rootVars && parsed.rootVars.length > 0) {
    runtimeConfig.root = parsed.rootVars;
  }
  if (parsed.variant && Object.keys(parsed.variant).length > 0) {
    if (parsed.simple) {
      const simpleVariantConfig: Record<
        string,
        Record<string, unknown>
      > = {};
      for (const [group, variants] of Object.entries(parsed.variant)) {
        const runtimeVariants: Record<string, unknown> = {};
        for (const [variantName, declarations] of Object.entries(variants)) {
          runtimeVariants[variantName] = declarations[SIMPLE_STYLE_KEY];
        }
        simpleVariantConfig[group] = runtimeVariants;
      }
      runtimeConfig.variant = simpleVariantConfig;
    } else {
      runtimeConfig.variant = parsed.variant;
    }
  }
  if (parsed.variantGlobal && Object.keys(parsed.variantGlobal).length > 0) {
    runtimeConfig.variantGlobal = parsed.variantGlobal;
  }
  if (parsed.defaults && Object.keys(parsed.defaults).length > 0) {
    runtimeConfig.defaults = parsed.defaults;
  }

  return JSON.stringify(runtimeConfig);
}

function loadInkConfig(
  searchStart: string,
  resolverOptions: {
    projectRoot: string;
    viteRoot: string;
    viteAliases: readonly ViteAliasEntry[];
    tsconfigResolver: TsconfigPathResolver | null;
  },
): LoadedInkConfig {
  const configPath = findCssConfigPath(searchStart);
  if (!configPath) {
    return {
      path: null,
      dependencies: [],
      imports: [],
      themeMode: "color-scheme",
      resolution: "hybrid",
      hasExplicitResolution: false,
      debug: {
        logDynamic: false,
        logStatic: false,
      },
      breakpoints: {},
      breakpointBoundary: "inclusive",
      containers: {},
      layers: [],
      defaultUnit: undefined,
      include: [],
      rootLayout: null,
      utilities: {},
      configCss: "",
      utilityCss: "",
      runtimeOptions: {
        themeMode: "color-scheme",
        breakpointBoundary: "inclusive",
      },
    };
  }

  const source = getNodeFs().readFileSync(configPath, "utf8");
  const configDir = getNodePath().dirname(configPath);
  const dependencies = new Set<string>();
  const sideEffectImports: string[] = [];
  const cssImportMatcher = /import\s*["']([^"']+\.css(?:\?[^"']*)?)["']\s*;?/g;
  for (
    let match = cssImportMatcher.exec(source);
    match;
    match = cssImportMatcher.exec(source)
  ) {
    sideEffectImports.push(`"${match[1]}"`);
  }

  const staticResolver = createStaticModuleResolver({
    loadModuleCode(moduleId) {
      if (moduleId === configPath) {
        return source;
      }
      try {
        dependencies.add(cleanId(moduleId));
        return getNodeFs().readFileSync(moduleId, "utf8");
      } catch {
        return null;
      }
    },
    resolveImportFile: (moduleId, importSource) =>
      resolveImportToFile(moduleId, importSource, resolverOptions),
    resolveRuntimeImport: resolveStaticInkImport,
    resolveAssetImport: (binding, tail, moduleId, resolvedImportFile) =>
      resolveStaticImageImport(
        binding,
        tail,
        moduleId,
        resolvedImportFile,
        resolverOptions,
      ),
  });

  const configModuleInfo = staticResolver.getModuleInfo(configPath);
  const defaultExpr = configModuleInfo?.defaultExportExpression ?? null;
  let configObject: Record<string, unknown> = {};

  if (defaultExpr) {
    const parsed = parseStaticExpression(
      defaultExpr,
      (identifierPath) =>
        staticResolver.resolveIdentifierInModule(identifierPath, configPath) ??
          undefined,
    );
    if (isRecord(parsed)) {
      configObject = parsed;
    } else if (configModuleInfo) {
      const evalScope: Record<string, unknown> = {
        ...staticResolver.buildEvalScope(configPath, undefined, defaultExpr),
        defineCssConfig: (input: unknown) => input,
      };
      const evaluated = evaluateExpression(defaultExpr, evalScope);
      if (isRecord(evaluated)) {
        configObject = evaluated;
      }
    }
  }

  const importsFromObject = Array.isArray(configObject.imports)
    ? configObject.imports
      .filter((entry): entry is string => typeof entry === "string")
      .map((
        entry,
      ) => (entry.startsWith('"') && entry.endsWith('"')
        ? entry
        : `"${entry}"`)
      )
    : [];
  const hasExplicitResolution = Object.prototype.hasOwnProperty.call(
    configObject,
    "resolution",
  );
  const resolution = normalizeResolution(configObject.resolution);
  const themeMode = normalizeThemeMode(configObject.themeMode);
  const debug = normalizeDebugOptions(configObject.debug);
  const breakpoints = normalizeBreakpoints(configObject.breakpoints);
  const breakpointBoundary = normalizeBreakpointBoundary(
    configObject.breakpointBoundary,
  );
  const containers = normalizeContainers(configObject.containers);
  const layers = normalizeLayers(configObject.layers);
  const defaultUnit = normalizeDefaultUnit(configObject.defaultUnit);
  const configFonts = Object.prototype.hasOwnProperty.call(
      configObject,
      "fonts",
    )
    ? fontsToConfig(
      configObject.fonts as Parameters<typeof fontsToConfig>[0],
    )
    : { imports: [], root: [] };

  const parsedThemes = Object.prototype.hasOwnProperty.call(
      configObject,
      "themes",
    )
    ? parseInkConfig(
      { themes: configObject.themes },
      { containers, themeMode },
    )
    : null;
  const parsedUtilities = isRecord(configObject.utilities)
    ? parseInkConfig({ base: configObject.utilities }, { containers })
    : null;
  const parsedImports = Object.prototype.hasOwnProperty.call(
      configObject,
      "import",
    )
    ? parseConfigImportInput(configObject.import, { containers })
    : null;
  const utilityImports = parsedUtilities?.imports ?? [];

  const dedupedRawImports = Array.from(
    new Set([
      ...sideEffectImports,
      ...importsFromObject,
      ...(parsedImports?.imports ?? []),
      ...utilityImports,
      ...configFonts.imports,
    ]),
  );
  const resolvedImports = dedupedRawImports
    .map((importPath) =>
      toBrowserStylesheetPath(importPath, configPath, {
        projectRoot: resolverOptions.projectRoot,
        viteRoot: resolverOptions.viteRoot,
        viteAliases: resolverOptions.viteAliases,
        tsconfigResolver: resolverOptions.tsconfigResolver,
      })
    )
    .filter((entry): entry is string => Boolean(entry));
  const allImports = Array.from(new Set(resolvedImports));

  const include = normalizeIncludePaths(configObject.include, configDir);
  const rootLayout = normalizeRootLayoutPath(
    configObject.rootLayout,
    configDir,
  );
  const configGlobalRules = {
    ...rootVarsToGlobalRules([
      ...(parsedThemes?.root ?? parsedThemes?.rootVars ?? []),
      ...configFonts.root,
    ]),
    ...(parsedThemes?.global ?? {}),
    ...(parsedImports?.global ?? {}),
  };
  const themeRules = Object.keys(configGlobalRules).length > 0
    ? toCssGlobalRules(configGlobalRules, {
      breakpoints,
      containers,
      defaultUnit,
    })
    : [];
  const layerOrderRule = toCssLayerOrderRule(layers);
  const configCss = [
    layerOrderRule,
    ...themeRules,
    ...(parsedImports?.tailwindCss ?? []),
  ].filter((part) => part.length > 0).join("\n");
  const utilitiesParsed = parsedUtilities?.base ?? {};

  const utilityRules = Object.entries(utilitiesParsed)
    .flatMap(([name, style]) => {
      if (!hasStyleDeclarations(style.declaration)) {
        return [];
      }

      return toCssRules(`u-${camelToKebab(name)}`, style.declaration, {
        breakpoints,
        containers,
        defaultUnit,
      });
    });
  const utilityCss = resolution === "dynamic" ? "" : utilityRules.join("\n");

  const runtimeOptions: LoadedInkConfig["runtimeOptions"] = {};
  if (Object.keys(breakpoints).length > 0) {
    runtimeOptions.breakpoints = breakpoints;
  }
  if (Object.keys(containers).length > 0) {
    runtimeOptions.containers = containers;
  }
  if (layers.length > 0) {
    runtimeOptions.layers = layers;
  }
  if (defaultUnit) {
    runtimeOptions.defaultUnit = defaultUnit;
  }
  if (Object.keys(utilitiesParsed).length > 0) {
    runtimeOptions.utilities = utilitiesParsed;
  }
  runtimeOptions.themeMode = themeMode;
  runtimeOptions.resolution = resolution;

  return {
    path: configPath,
    dependencies: Array.from(dependencies),
    imports: allImports,
    themeMode,
    resolution,
    hasExplicitResolution,
    debug,
    breakpoints,
    breakpointBoundary,
    containers,
    layers,
    defaultUnit,
    include,
    rootLayout,
    utilities: utilitiesParsed,
    configCss,
    utilityCss,
    runtimeOptions,
  };
}

function getTsTranspiler(): ((source: string) => string) | null {
  if (tsTranspiler !== undefined) {
    return tsTranspiler;
  }

  const typescript = getTypeScriptModule();
  if (!typescript) {
    tsTranspiler = null;
    return null;
  }

  tsTranspiler = (source: string): string =>
    typescript.transpileModule(source, {
      compilerOptions: {
        target: typescript.ScriptTarget.ES2020,
        module: typescript.ModuleKind.ESNext,
      },
    }).outputText;
  return tsTranspiler;
}

function splitTopLevelSegments(
  source: string,
  separator: string,
): string[] {
  const segments: string[] = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString: "" | '"' | "'" | "`" = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      current += char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      current += char;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      current += char;
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      current += char;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      current += char;
      continue;
    }

    if (
      char === separator &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      segments.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  segments.push(current);
  return segments;
}

function findTopLevelCharacter(source: string, target: string): number {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inString: "" | '"' | "'" | "`" = "";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (
      char === target &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

function stripTypeAnnotationsFromParameters(source: string): string {
  return splitTopLevelSegments(source, ",")
    .map((segment) => {
      const trimmed = segment.trim();
      if (trimmed.length === 0) {
        return trimmed;
      }

      const equalsIndex = findTopLevelCharacter(trimmed, "=");
      const head = equalsIndex === -1
        ? trimmed
        : trimmed.slice(0, equalsIndex).trimEnd();
      const tail = equalsIndex === -1
        ? ""
        : trimmed.slice(equalsIndex).trimStart();

      const typeAnnotationIndex = findTopLevelCharacter(head, ":");
      let strippedHead = typeAnnotationIndex === -1
        ? head
        : head.slice(0, typeAnnotationIndex).trimEnd();
      strippedHead = strippedHead.replace(/\?$/, "");

      return tail.length > 0 ? `${strippedHead} ${tail}` : strippedHead;
    })
    .join(", ");
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let inString: "" | '"' | "'" | "`" = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findArrowAfterParams(
  source: string,
  closeIndex: number,
): { arrowIndex: number; returnTypeStart: number | null } | null {
  let cursor = closeIndex + 1;
  while (cursor < source.length && /\s/.test(source[cursor])) {
    cursor += 1;
  }

  if (source[cursor] === "=" && source[cursor + 1] === ">") {
    return { arrowIndex: cursor, returnTypeStart: null };
  }

  if (source[cursor] !== ":") {
    return null;
  }

  const returnTypeStart = cursor;
  cursor += 1;

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let angleDepth = 0;
  let inString: "" | '"' | "'" | "`" = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (; cursor < source.length; cursor += 1) {
    const char = source[cursor];
    const next = source[cursor + 1];

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        cursor += 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === inString) {
        inString = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      cursor += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      cursor += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      inString = char;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === "[") {
      bracketDepth += 1;
      continue;
    }
    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (char === "{") {
      braceDepth += 1;
      continue;
    }
    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }
    if (char === "<") {
      angleDepth += 1;
      continue;
    }
    if (char === ">") {
      angleDepth = Math.max(0, angleDepth - 1);
      continue;
    }

    if (
      char === "=" &&
      next === ">" &&
      parenDepth === 0 &&
      bracketDepth === 0 &&
      braceDepth === 0 &&
      angleDepth === 0
    ) {
      return { arrowIndex: cursor, returnTypeStart };
    }
  }

  return null;
}

function stripArrowFunctionTypeAnnotations(source: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const openIndex = source.indexOf("(", cursor);
    if (openIndex === -1) {
      output += source.slice(cursor);
      break;
    }

    const closeIndex = findMatchingParen(source, openIndex);
    if (closeIndex === -1) {
      output += source.slice(cursor);
      break;
    }

    const arrowInfo = findArrowAfterParams(source, closeIndex);
    if (!arrowInfo) {
      output += source.slice(cursor, openIndex + 1);
      cursor = openIndex + 1;
      continue;
    }

    output += source.slice(cursor, openIndex + 1);
    output += stripTypeAnnotationsFromParameters(
      source.slice(openIndex + 1, closeIndex),
    );
    output += ")";
    if (arrowInfo.returnTypeStart === null) {
      output += source.slice(closeIndex + 1, arrowInfo.arrowIndex);
    } else {
      output += source.slice(closeIndex + 1, arrowInfo.returnTypeStart);
    }
    output += "=>";
    cursor = arrowInfo.arrowIndex + 2;
  }

  return output;
}

function stripTypeScriptSnippetFallback(source: string): string {
  return stripArrowFunctionTypeAnnotations(
    source
      .replace(
        /function(\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)\s*(?::\s*[^({=]+)?\s*\{/g,
        (_match, name: string | undefined, params: string) =>
          `function${name ?? ""}(${
            stripTypeAnnotationsFromParameters(params)
          }) {`,
      )
      .replace(/\s+as\s+const\b/g, "")
      .trim(),
  );
}

function transpileTsSnippet(source: string): string {
  const transpile = getTsTranspiler();
  if (!transpile) {
    return stripTypeScriptSnippetFallback(source);
  }

  let output = transpile(source)
    .replace(/^\/\/# sourceMappingURL=.*$/gm, "")
    .replace(/^(?:(?:"use strict"|'use strict');\s*)+/, "")
    .trim();
  while (output.endsWith(";")) {
    output = output.slice(0, -1).trimEnd();
  }
  return output;
}

function evaluateExpression(
  source: string,
  scope: Record<string, unknown>,
): unknown | null {
  const IDENTIFIER_PROXY_PATH = Symbol("ink-identifier-proxy-path");
  const createIdentifierProxy = (path: string[]): unknown =>
    new Proxy({ [IDENTIFIER_PROXY_PATH]: path }, {
      get(_target, key) {
        if (key === IDENTIFIER_PROXY_PATH) {
          return path;
        }
        if (key === Symbol.toPrimitive) {
          return () => path[path.length - 1] ?? "";
        }
        if (key === "toString" || key === "valueOf") {
          return () => path[path.length - 1] ?? "";
        }
        if (typeof key === "string") {
          return createIdentifierProxy([...path, key]);
        }
        return undefined;
      },
    });
  const materializeIdentifierProxies = (
    value: unknown,
    seen = new WeakMap<object, unknown>(),
  ): unknown => {
    if (typeof value !== "object" || value === null) {
      return value;
    }

    const proxyPath = (value as Record<PropertyKey, unknown>)[
      IDENTIFIER_PROXY_PATH
    ];
    if (
      Array.isArray(proxyPath) &&
      proxyPath.every((segment) => typeof segment === "string")
    ) {
      return {
        kind: "identifier-ref",
        path: [...proxyPath],
      };
    }

    if (seen.has(value)) {
      return seen.get(value);
    }

    if (Array.isArray(value)) {
      const resolved: unknown[] = [];
      seen.set(value, resolved);
      for (const entry of value) {
        resolved.push(materializeIdentifierProxies(entry, seen));
      }
      return resolved;
    }

    const resolved: Record<string, unknown> = {};
    seen.set(value, resolved);
    for (const [key, entry] of Object.entries(value)) {
      resolved[key] = materializeIdentifierProxies(entry, seen);
    }
    return resolved;
  };

  const jsSource = transpileTsSnippet(`(${source})`);
  try {
    const proxyScope = new Proxy(scope, {
      has(target, key) {
        return true;
      },
      get(target, key) {
        if (key in target) {
          return target[key as string];
        }
        if (key === Symbol.unscopables) {
          return undefined;
        }
        if (typeof key === "string" && key in globalThis) {
          return globalThis[key as keyof typeof globalThis];
        }
        if (typeof key === "string") {
          return createIdentifierProxy([key]);
        }
        return undefined;
      },
    });

    const fn = new Function(
      "__scope",
      `with (__scope) { return ${jsSource}; }`,
    );
    return materializeIdentifierProxies(fn(proxyScope));
  } catch {
    return null;
  }
}

function evaluateFunctionDeclaration(
  source: string,
  scope: Record<string, unknown>,
): unknown | null {
  try {
    const jsSource = transpileTsSnippet(source);
    const proxyScope = new Proxy(scope, {
      has(target, key) {
        return true;
      },
      get(target, key) {
        if (key in target) {
          return target[key as string];
        }
        if (key === Symbol.unscopables) {
          return undefined;
        }
        if (typeof key === "string" && key in globalThis) {
          return globalThis[key as keyof typeof globalThis];
        }
        return key;
      },
    });

    const fn = new Function(
      "__scope",
      `with (__scope) { return (${jsSource}); }`,
    );
    return fn(proxyScope);
  } catch {
    return null;
  }
}

function resolveFileFromBase(basePath: string): string | null {
  const candidates: string[] = [];
  if (getNodePath().extname(basePath)) {
    candidates.push(basePath);
  } else {
    for (const extension of STATIC_STYLE_EXTENSIONS) {
      candidates.push(`${basePath}${extension}`);
      candidates.push(getNodePath().join(basePath, `index${extension}`));
    }
  }

  for (const candidate of candidates) {
    if (
      getNodeFs().existsSync(candidate) &&
      getNodeFs().statSync(candidate).isFile()
    ) {
      return getNodePath().normalize(candidate);
    }
  }

  return null;
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = i + 1 < input.length ? input[i + 1] : "";

    if (inLineComment) {
      if (char === "\n" || char === "\r") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      output += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      let cursor = i + 1;
      while (cursor < input.length && /\s/.test(input[cursor])) {
        cursor += 1;
      }
      if (
        cursor < input.length &&
        (input[cursor] === "}" || input[cursor] === "]")
      ) {
        continue;
      }
    }

    output += char;
  }

  return output;
}

function parseJsonc(input: string): unknown | null {
  const withoutComments = stripJsonComments(input);
  const cleaned = removeTrailingCommas(withoutComments);
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function parseJsoncFile(filePath: string): Record<string, unknown> | null {
  try {
    const raw = getNodeFs().readFileSync(filePath, "utf8");
    const parsed = parseJsonc(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveTsconfigExtendsPath(
  configDir: string,
  extendsValue: string,
): string | null {
  if (extendsValue.startsWith(".")) {
    const withExtension = extendsValue.endsWith(".json")
      ? extendsValue
      : `${extendsValue}.json`;
    return getNodePath().resolve(configDir, withExtension);
  }

  if (extendsValue.startsWith("/")) {
    return extendsValue;
  }

  const candidate = getNodePath().resolve(
    configDir,
    "node_modules",
    extendsValue,
  );
  if (
    getNodeFs().existsSync(candidate) &&
    getNodeFs().statSync(candidate).isFile()
  ) {
    return candidate;
  }
  if (
    getNodeFs().existsSync(`${candidate}.json`) &&
    getNodeFs().statSync(`${candidate}.json`).isFile()
  ) {
    return `${candidate}.json`;
  }
  const nested = getNodePath().resolve(candidate, "tsconfig.json");
  if (getNodeFs().existsSync(nested) && getNodeFs().statSync(nested).isFile()) {
    return nested;
  }

  return null;
}

function loadTsconfigCompilerOptions(
  tsconfigPath: string,
  visited = new Set<string>(),
): {
  baseUrl?: string;
  paths?: Record<string, string[]>;
} | null {
  const normalizedPath = getNodePath().normalize(tsconfigPath);
  if (visited.has(normalizedPath)) {
    return null;
  }
  visited.add(normalizedPath);

  const config = parseJsoncFile(normalizedPath);
  if (!config) {
    return null;
  }

  const configDir = getNodePath().dirname(normalizedPath);
  let mergedBaseUrl: string | undefined;
  let mergedPaths: Record<string, string[]> = {};

  const rawExtends = config.extends;
  if (typeof rawExtends === "string") {
    const parentPath = resolveTsconfigExtendsPath(configDir, rawExtends);
    if (parentPath) {
      const parent = loadTsconfigCompilerOptions(parentPath, visited);
      if (parent?.baseUrl) {
        mergedBaseUrl = getNodePath().resolve(
          getNodePath().dirname(parentPath),
          parent.baseUrl,
        );
      }
      if (parent?.paths) {
        mergedPaths = { ...parent.paths };
      }
    }
  }

  const rawCompilerOptions = config.compilerOptions;
  if (isRecord(rawCompilerOptions)) {
    const rawBaseUrl = rawCompilerOptions.baseUrl;
    if (typeof rawBaseUrl === "string") {
      mergedBaseUrl = getNodePath().resolve(configDir, rawBaseUrl);
    }

    const rawPaths = rawCompilerOptions.paths;
    if (isRecord(rawPaths)) {
      for (const [pattern, targetValue] of Object.entries(rawPaths)) {
        if (!Array.isArray(targetValue)) {
          continue;
        }
        const targets = targetValue.filter((entry): entry is string =>
          typeof entry === "string"
        );
        if (targets.length > 0) {
          mergedPaths[pattern] = targets;
        }
      }
    }
  }

  return {
    // Only propagate baseUrl when it is explicitly defined by this config chain.
    // Falling back to configDir here makes extended configs (for example
    // "astro/tsconfigs/strict") incorrectly become the alias root.
    baseUrl: mergedBaseUrl,
    paths: mergedPaths,
  };
}

function createTsconfigResolver(
  searchStart: string,
): TsconfigPathResolver | null {
  const tsconfigPath = findTsconfigPath(searchStart);
  if (!tsconfigPath) {
    return null;
  }

  const compilerOptions = loadTsconfigCompilerOptions(tsconfigPath);
  if (!compilerOptions?.paths) {
    return null;
  }

  const tsconfigDir = getNodePath().dirname(tsconfigPath);
  const baseUrl = compilerOptions.baseUrl ?? tsconfigDir;
  const pathMatchers: TsconfigPathMatcher[] = [];

  for (const [pattern, targets] of Object.entries(compilerOptions.paths)) {
    const wildcardIndex = pattern.indexOf("*");
    const hasWildcard = wildcardIndex !== -1;
    const prefix = hasWildcard ? pattern.slice(0, wildcardIndex) : pattern;
    const suffix = hasWildcard ? pattern.slice(wildcardIndex + 1) : "";

    pathMatchers.push({
      pattern,
      prefix,
      suffix,
      hasWildcard,
      targets,
    });
  }

  pathMatchers.sort((a, b) => b.pattern.length - a.pattern.length);

  return {
    resolve(source: string): string | null {
      for (const matcher of pathMatchers) {
        let wildcardValue = "";

        if (matcher.hasWildcard) {
          if (!source.startsWith(matcher.prefix)) {
            continue;
          }
          if (!source.endsWith(matcher.suffix)) {
            continue;
          }
          const dynamicStart = matcher.prefix.length;
          const dynamicEnd = source.length - matcher.suffix.length;
          if (dynamicEnd < dynamicStart) {
            continue;
          }
          wildcardValue = source.slice(dynamicStart, dynamicEnd);
        } else if (source !== matcher.pattern) {
          continue;
        }

        for (const target of matcher.targets) {
          const resolvedTarget = matcher.hasWildcard
            ? target.replace(/\*/g, wildcardValue)
            : target;
          const candidateBase = getNodePath().isAbsolute(resolvedTarget)
            ? resolvedTarget
            : getNodePath().resolve(baseUrl, resolvedTarget);
          const resolvedFile = resolveFileFromBase(candidateBase);
          if (resolvedFile) {
            return resolvedFile;
          }
        }
      }

      const baseUrlFallback = resolveFileFromBase(
        getNodePath().resolve(baseUrl, source),
      );
      return baseUrlFallback;
    },
  };
}

function normalizeViteAliases(alias: unknown): ViteAliasEntry[] {
  if (Array.isArray(alias)) {
    return alias
      .filter((entry): entry is ViteAliasEntry => {
        if (!isRecord(entry)) {
          return false;
        }
        const find = entry.find;
        const replacement = entry.replacement;
        if (typeof replacement !== "string") {
          return false;
        }
        return typeof find === "string" || find instanceof RegExp;
      })
      .map((entry) => ({
        find: entry.find,
        replacement: entry.replacement,
      }));
  }

  if (!isRecord(alias)) {
    return [];
  }

  return Object.entries(alias)
    .filter(([, replacement]) => typeof replacement === "string")
    .map(([find, replacement]) => ({
      find,
      replacement: replacement as string,
    }));
}

function applyViteAlias(source: string, alias: ViteAliasEntry): string | null {
  if (typeof alias.find === "string") {
    if (source === alias.find) {
      return alias.replacement;
    }
    if (source.startsWith(`${alias.find}/`)) {
      return `${alias.replacement}${source.slice(alias.find.length)}`;
    }
    return null;
  }

  alias.find.lastIndex = 0;
  if (!alias.find.test(source)) {
    return null;
  }
  alias.find.lastIndex = 0;
  return source.replace(alias.find, alias.replacement);
}

function resolveAliasedPath(
  importerId: string,
  source: string,
  options: Pick<ImportResolverOptions, "projectRoot" | "viteRoot">,
): string | null {
  if (source.startsWith(".")) {
    return resolveFileFromBase(
      getNodePath().resolve(getNodePath().dirname(importerId), source),
    );
  }

  if (getNodePath().isAbsolute(source)) {
    const rootRelative = resolveFileFromBase(
      getNodePath().resolve(options.viteRoot, `.${source}`),
    );
    if (rootRelative) {
      return rootRelative;
    }
    const resolved = resolveFileFromBase(source);
    if (resolved) {
      return resolved;
    }
    return null;
  }

  const projectRelative = resolveFileFromBase(
    getNodePath().resolve(options.projectRoot, source),
  );
  if (projectRelative) {
    return projectRelative;
  }

  if (options.viteRoot !== options.projectRoot) {
    return resolveFileFromBase(getNodePath().resolve(options.viteRoot, source));
  }

  return null;
}

function inferProjectRootFromImporter(importerId: string): string | null {
  const normalized = getNodePath().normalize(importerId);
  const marker = `${getNodePath().sep}src${getNodePath().sep}`;
  const markerIndex = normalized.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }
  const inferred = normalized.slice(0, markerIndex);
  return inferred || getNodePath().parse(normalized).root;
}

function resolveImportToFile(
  importerId: string,
  source: string,
  options: ImportResolverOptions,
): string | null {
  if (source.startsWith(".")) {
    const base = getNodePath().resolve(
      getNodePath().dirname(importerId),
      source,
    );
    return resolveFileFromBase(base);
  }

  if (source.startsWith("/")) {
    const resolvedRootRelative = resolveFileFromBase(
      getNodePath().resolve(options.viteRoot, `.${source}`),
    );
    if (resolvedRootRelative) {
      return resolvedRootRelative;
    }
    return resolveFileFromBase(source);
  }

  for (const alias of options.viteAliases) {
    const aliased = applyViteAlias(source, alias);
    if (!aliased) {
      continue;
    }

    const resolvedAliased = resolveAliasedPath(
      importerId,
      aliased,
      options,
    );
    if (resolvedAliased) {
      return resolvedAliased;
    }
  }

  if (source === "$lib" || source.startsWith("$lib/")) {
    const projectRoot = inferProjectRootFromImporter(importerId) ??
      options.projectRoot;
    if (!projectRoot) {
      return null;
    }

    const suffix = source === "$lib" ? "" : source.slice("$lib/".length);
    const base = getNodePath().join(projectRoot, "src", "lib", suffix);
    return resolveFileFromBase(base);
  }

  if (options.tsconfigResolver) {
    const resolved = options.tsconfigResolver.resolve(source);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function moduleIdToFilePath(id: string, viteRoot: string): string | null {
  if (id.startsWith("\0")) {
    return null;
  }

  let normalizedId = id;
  if (normalizedId.startsWith("file://")) {
    try {
      const url = new URL(normalizedId);
      if (url.protocol !== "file:") {
        return null;
      }
      normalizedId = decodeURIComponent(url.pathname);
      if (/^\/[A-Za-z]:\//.test(normalizedId)) {
        normalizedId = normalizedId.slice(1);
      }
    } catch {
      return null;
    }
  }

  if (getNodePath().isAbsolute(normalizedId)) {
    const absolute = getNodePath().normalize(normalizedId);
    if (getNodeFs().existsSync(absolute)) {
      return absolute;
    }

    const rootRelative = getNodePath().resolve(viteRoot, `.${normalizedId}`);
    if (getNodeFs().existsSync(rootRelative)) {
      return getNodePath().normalize(rootRelative);
    }

    return absolute;
  }

  return getNodePath().normalize(
    getNodePath().resolve(viteRoot, normalizedId),
  );
}

function isPathWithinScope(filePath: string, scopePath: string): boolean {
  const relative = getNodePath().relative(scopePath, filePath);
  return relative === "" ||
    (!relative.startsWith("..") && !getNodePath().isAbsolute(relative));
}

function isInDefaultTransformScope(
  id: string,
  viteRoot: string,
  projectRoot: string,
  includePaths: readonly string[],
): boolean {
  const modulePath = moduleIdToFilePath(id, viteRoot);
  if (!modulePath) {
    return false;
  }

  if (viteRoot !== projectRoot && isPathWithinScope(modulePath, viteRoot)) {
    return true;
  }

  const defaultSourceDirs = ["src", "app"];
  for (const sourceDir of defaultSourceDirs) {
    const sourcePath = getNodePath().resolve(projectRoot, sourceDir);
    if (isPathWithinScope(modulePath, sourcePath)) {
      return true;
    }
  }

  for (const includePath of includePaths) {
    if (isPathWithinScope(modulePath, includePath)) {
      return true;
    }
  }

  return false;
}

function isConfiguredRootLayout(
  id: string,
  rootLayout: string | null,
  viteRoot: string,
): boolean {
  if (!rootLayout) {
    return false;
  }

  const modulePath = moduleIdToFilePath(id, viteRoot);
  return modulePath !== null &&
    getNodePath().normalize(modulePath) === rootLayout;
}

/** Options for {@link inkVite}. */
export interface InkVitePluginOptions {
  /** Override the default scope (`<root>/{src,app}/**`) with a custom id matcher. */
  include?: RegExp;
}

/**
 * Vite plugin that extracts `ink()` usage and emits a virtual stylesheet.
 */
export function inkVite(options: InkVitePluginOptions = {}): any {
  const moduleImports = new Map<string, string[]>();
  const moduleCss = new Map<string, string>();
  const managedModules = new Set<string>();
  const moduleStaticDependencies = new Map<string, Set<string>>();
  const dependencyOwners = new Map<string, Set<string>>();
  let server: ViteDevServerLike | undefined;
  let viteRoot = process.cwd();
  let projectRoot = process.cwd();
  let viteAliases: ViteAliasEntry[] = [];
  let tsconfigResolver: TsconfigPathResolver | null = null;
  let inkConfig: LoadedInkConfig = {
    path: null,
    dependencies: [],
    imports: [],
    themeMode: "color-scheme",
    resolution: "hybrid",
    hasExplicitResolution: false,
    debug: {
      logDynamic: false,
      logStatic: false,
    },
    breakpoints: {},
    breakpointBoundary: "inclusive",
    containers: {},
    layers: [],
    defaultUnit: undefined,
    include: [],
    rootLayout: null,
    utilities: {},
    configCss: "",
    utilityCss: "",
    runtimeOptions: {
      themeMode: "color-scheme",
      breakpointBoundary: "inclusive",
    },
  };
  let resolverInitialized = false;

  function initializeResolvers(root: string): void {
    viteRoot = root;
    projectRoot = findProjectRoot(root);
    tsconfigResolver = createTsconfigResolver(viteRoot);
    inkConfig = loadInkConfig(viteRoot, {
      projectRoot,
      viteRoot,
      viteAliases,
      tsconfigResolver,
    });
    resolverInitialized = true;
  }

  function ensureResolvers(importerId: string): void {
    if (resolverInitialized) {
      return;
    }
    const inferredRoot = inferProjectRootFromImporter(importerId);
    initializeResolvers(inferredRoot ?? viteRoot);
  }

  function combinedCss(): string {
    const parts: string[] = [];
    for (const cssImport of inkConfig.imports) {
      parts.push(`@import ${cssImport};`);
    }
    const dedupedModuleImports = new Set<string>();
    for (const imports of moduleImports.values()) {
      for (const cssImport of imports) {
        dedupedModuleImports.add(cssImport);
      }
    }
    for (const cssImport of dedupedModuleImports) {
      parts.push(`@import ${cssImport};`);
    }
    if (inkConfig.configCss) {
      parts.push(inkConfig.configCss);
    }
    if (inkConfig.utilityCss) {
      parts.push(inkConfig.utilityCss);
    }
    parts.push(mergeCss(moduleCss.values()));
    return parts.filter((part) => part.length > 0).join("\n");
  }

  function moduleScopedCss(moduleId: string): string {
    const parts: string[] = [];
    const imports = moduleImports.get(moduleId) ?? [];
    for (const cssImport of imports) {
      parts.push(`@import ${cssImport};`);
    }
    const rules = moduleCss.get(moduleId);
    if (rules && rules.length > 0) {
      parts.push(rules);
    }
    return parts.join("\n");
  }

  function updateModuleStaticDependencies(
    moduleId: string,
    dependencies: Iterable<string>,
  ): void {
    const previous = moduleStaticDependencies.get(moduleId);
    if (previous) {
      for (const dependency of previous) {
        const owners = dependencyOwners.get(dependency);
        if (!owners) {
          continue;
        }
        owners.delete(moduleId);
        if (owners.size === 0) {
          dependencyOwners.delete(dependency);
        }
      }
      moduleStaticDependencies.delete(moduleId);
    }

    const next = new Set<string>();
    for (const dependency of dependencies) {
      const normalizedDependency = cleanId(dependency);
      if (!normalizedDependency || normalizedDependency === moduleId) {
        continue;
      }
      next.add(normalizedDependency);
    }

    if (next.size === 0) {
      return;
    }

    moduleStaticDependencies.set(moduleId, next);
    for (const dependency of next) {
      const owners = dependencyOwners.get(dependency) ?? new Set<string>();
      owners.add(moduleId);
      dependencyOwners.set(dependency, owners);
    }
  }

  function clearManagedModuleState(moduleId: string): boolean {
    managedModules.delete(moduleId);
    updateModuleStaticDependencies(moduleId, []);

    let didChange = false;
    if (moduleCss.delete(moduleId)) {
      didChange = true;
    }
    if (moduleImports.delete(moduleId)) {
      didChange = true;
    }
    return didChange;
  }

  function addWatchFiles(
    ctx: ViteTransformContextLike | undefined,
    dependencies: Iterable<string>,
  ): void {
    if (typeof ctx?.addWatchFile !== "function") {
      return;
    }

    for (const dependency of dependencies) {
      ctx.addWatchFile(dependency);
    }
  }

  function invalidateGraphModule(
    module: unknown,
    timestamp?: number,
    invalidatedModules?: Set<unknown>,
  ): void {
    if (!server) {
      return;
    }
    server.moduleGraph.invalidateModule(
      module,
      invalidatedModules,
      timestamp,
      true,
    );
  }

  function invalidateModuleById(
    id: string,
    timestamp?: number,
    invalidatedModules?: Set<unknown>,
  ): unknown[] {
    if (!server) {
      return [];
    }
    const module = server.moduleGraph.getModuleById(id);
    if (module) {
      invalidateGraphModule(module, timestamp, invalidatedModules);
      return [module];
    }
    return [];
  }

  function invalidateModulesByFile(
    file: string,
    timestamp?: number,
    invalidatedModules?: Set<unknown>,
  ): unknown[] {
    if (!server) {
      return [];
    }

    const modules = server.moduleGraph.getModulesByFile?.(file);
    if (modules && modules.size > 0) {
      const invalidated = Array.from(modules);
      for (const module of invalidated) {
        invalidateGraphModule(module, timestamp, invalidatedModules);
      }
      return invalidated;
    }

    const fallback = server.moduleGraph.getModuleById(file);
    if (!fallback) {
      return [];
    }

    invalidateGraphModule(fallback, timestamp, invalidatedModules);
    return [fallback];
  }

  function invalidateVirtualModules(
    moduleIds: Iterable<string> = [],
    timestamp?: number,
    invalidatedModules?: Set<unknown>,
  ): unknown[] {
    const invalidated = new Set<unknown>();
    for (
      const module of invalidateModuleById(
        RESOLVED_VIRTUAL_ID,
        timestamp,
        invalidatedModules,
      )
    ) {
      invalidated.add(module);
    }
    for (const moduleId of moduleIds) {
      for (
        const module of invalidateModuleById(
          resolvedModuleVirtualId(moduleId),
          timestamp,
          invalidatedModules,
        )
      ) {
        invalidated.add(module);
      }
    }
    return Array.from(invalidated);
  }

  function invalidateManagedModules(
    moduleIds: Iterable<string>,
    timestamp?: number,
    invalidatedModules?: Set<unknown>,
  ): unknown[] {
    const normalizedIds = new Set<string>();
    for (const moduleId of moduleIds) {
      normalizedIds.add(cleanId(moduleId));
    }

    const invalidated = new Set<unknown>();
    for (const moduleId of normalizedIds) {
      for (
        const module of invalidateModulesByFile(
          moduleId,
          timestamp,
          invalidatedModules,
        )
      ) {
        invalidated.add(module);
      }
    }
    for (
      const module of invalidateVirtualModules(
        normalizedIds,
        timestamp,
        invalidatedModules,
      )
    ) {
      invalidated.add(module);
    }
    return Array.from(invalidated);
  }

  return {
    name: "ink",
    enforce: "pre",

    configureServer(devServer: ViteDevServerLike) {
      server = devServer;
    },

    configResolved(config: ViteResolvedConfigLike) {
      viteRoot = config.root;
      viteAliases = normalizeViteAliases(config.resolve.alias);
      initializeResolvers(viteRoot);
    },

    resolveId(id: string) {
      if (cleanId(id) === PUBLIC_VIRTUAL_ID) {
        const suffix = id.slice(PUBLIC_VIRTUAL_ID.length);
        return `${RESOLVED_VIRTUAL_ID}${suffix}`;
      }
      if (cleanId(id) === PUBLIC_TAILWIND_RUNTIME_ID) {
        return RESOLVED_TAILWIND_RUNTIME_ID;
      }
      return null;
    },

    load(id: string) {
      if (cleanId(id) === RESOLVED_VIRTUAL_ID) {
        const moduleId = readModuleVirtualImportId(id);
        if (moduleId) {
          return moduleScopedCss(moduleId);
        }
        return combinedCss();
      }
      if (cleanId(id) === RESOLVED_TAILWIND_RUNTIME_ID) {
        return loadTailwindRuntimeModule();
      }
      return null;
    },

    transform(
      this: ViteTransformContextLike | undefined,
      code: string,
      id: string,
    ) {
      if (isVirtualSubRequest(id)) {
        return null;
      }

      const normalizedId = cleanId(id);
      ensureResolvers(normalizedId);
      if (!supportsTransform(normalizedId)) {
        return null;
      }
      const isRootLayout = isConfiguredRootLayout(
        normalizedId,
        inkConfig.rootLayout,
        viteRoot,
      );
      if (
        options.include && !options.include.test(normalizedId) && !isRootLayout
      ) {
        return null;
      }
      if (
        !options.include &&
        !isRootLayout &&
        !isInDefaultTransformScope(
          normalizedId,
          viteRoot,
          projectRoot,
          inkConfig.include,
        )
      ) {
        return null;
      }
      const isSvelte = normalizedId.endsWith(".svelte");
      const isAstro = normalizedId.endsWith(".astro");
      let nextCode = code;
      const sourceRegions = extractTransformSourceRegions(
        code,
        normalizedId,
        { isSvelte, isAstro, projectRoot, viteRoot },
      );
      const currentStaticModuleCode = mergeSourceRegions(sourceRegions);
      const astTargets = collectTransformTargetsFromRegions(sourceRegions);
      const transformTargets = astTargets ??
        collectLegacyTransformTargetsFromRegions(sourceRegions);
      const newInkDecls: AstNewInkDeclaration[] = transformTargets.newInkDecls;
      const calls = transformTargets.calls;
      if (calls.length === 0 && newInkDecls.length === 0) {
        if (isRootLayout) {
          const didVirtualCssChange = clearManagedModuleState(normalizedId);
          managedModules.add(normalizedId);
          nextCode = addVirtualImportToModule(nextCode, { isSvelte, isAstro });
          if (didVirtualCssChange) {
            invalidateVirtualModules();
          }
          return {
            code: nextCode,
            map: null,
          };
        }

        if (!isSvelte && !isAstro) {
          return null;
        }

        const usesStylesCall = /\bstyles\s*\(\s*\)/.test(nextCode);
        if (!usesStylesCall) {
          return null;
        }

        nextCode = isSvelte
          ? addVirtualImportToSvelte(nextCode)
          : addVirtualImportToAstro(nextCode);
        return {
          code: nextCode,
          map: null,
        };
      }

      const replacements: Array<{ start: number; end: number; text: string }> =
        [];
      const importRules = new Set<string>();
      const rules = new Set<string>();
      const resolution = isAstro && !inkConfig.hasExplicitResolution
        ? "static"
        : inkConfig.resolution;
      const runtimeOptionsForRuntime: LoadedInkConfig["runtimeOptions"] = {
        ...inkConfig.runtimeOptions,
      };
      if (runtimeOptionsForRuntime.themeMode === "color-scheme") {
        delete runtimeOptionsForRuntime.themeMode;
      }
      runtimeOptionsForRuntime.resolution = resolution;
      if (server && (inkConfig.debug.logDynamic || inkConfig.debug.logStatic)) {
        runtimeOptionsForRuntime.debug = {
          enabled: true,
          logDynamic: inkConfig.debug.logDynamic,
          logStatic: inkConfig.debug.logStatic,
        };
      }
      const runtimeOptionsLiteral = JSON.stringify(runtimeOptionsForRuntime);
      const shouldLogStatic = Boolean(server && inkConfig.debug.logStatic);
      const moduleInfoCache = new Map<string, ModuleStaticInfo>();
      const staticDependencies = new Set<string>();
      const cssModuleMappings = new Map<string, Record<string, string>>();
      const importResolverOptions = {
        projectRoot,
        viteRoot,
        viteAliases,
        tsconfigResolver,
      };
      const staticResolver = createStaticModuleResolver({
        moduleInfoCache,
        loadModuleCode(moduleId) {
          if (moduleId === normalizedId) {
            return currentStaticModuleCode;
          }
          try {
            staticDependencies.add(cleanId(moduleId));
            return getNodeFs().readFileSync(moduleId, "utf8");
          } catch {
            return null;
          }
        },
        resolveImportFile: (moduleId, importSource) =>
          resolveImportToFile(moduleId, importSource, importResolverOptions),
        resolveRuntimeImport: resolveStaticInkImport,
        resolveAssetImport: (binding, tail, moduleId, resolvedImportFile) =>
          resolveStaticImageImport(
            binding,
            tail,
            moduleId,
            resolvedImportFile,
            importResolverOptions,
          ),
        resolveExtra(identifierPath, moduleId) {
          if (moduleId !== normalizedId || identifierPath.length === 0) {
            return null;
          }
          const head = identifierPath[0];
          if (!cssModuleMappings.has(head)) {
            return null;
          }
          const mapping = cssModuleMappings.get(head)!;
          return identifierPath.length > 1
            ? readMemberPath(mapping, identifierPath.slice(1))
            : mapping;
        },
      });
      const getModuleInfo = staticResolver.getModuleInfo;
      const resolveIdentifierInModule =
        staticResolver.resolveIdentifierInModule;

      const runSync = () => {
        function lineAt(index: number): number {
          let line = 1;
          for (let i = 0; i < index; i += 1) {
            if (nextCode[i] === "\n") {
              line += 1;
            }
          }
          return line;
        }

        function staticResolutionError(message: string, index: number): Error {
          return new Error(
            `[ink] ${message} (${normalizedId}:${lineAt(index)})`,
          );
        }

        function logStatic(message: string): void {
          if (!shouldLogStatic) {
            return;
          }
          console.log(`[ink][static] ${normalizedId} ${message}`);
        }

        function withRuntimeOptionsInNewInkInitializer(
          constructorSource: string,
          optionsSource?: string,
        ): string {
          return `new ${constructorSource}(${
            optionsSource ?? "undefined"
          }, undefined, ${runtimeOptionsLiteral})`;
        }

        function parseStaticInkConfigSource(source: string) {
          const parseOptions = {
            utilities: inkConfig.utilities,
            containers: inkConfig.containers,
            themeMode: inkConfig.themeMode,
          };
          const parsed = parseInkCallArgumentsWithResolver(
            source,
            (identifierPath) =>
              resolveIdentifierInModule(identifierPath, normalizedId) ??
                undefined,
            parseOptions,
          ) ?? parseInkCallArguments(source, parseOptions);
          if (parsed) {
            return parsed;
          }

          const evaluated = parseStaticExpression(
            source,
            (identifierPath) =>
              resolveIdentifierInModule(identifierPath, normalizedId) ??
                undefined,
          ) ?? evaluateExpression(
            source,
            staticResolver.buildEvalScope(normalizedId, undefined, source),
          );
          if (!isRecord(evaluated)) {
            return null;
          }

          return parseInkConfig(evaluated, parseOptions);
        }

        for (const call of calls) {
          if (resolution === "dynamic") {
            replacements.push({
              start: call.start,
              end: call.end,
              text:
                `${call.callee}(${call.arg}, undefined, ${runtimeOptionsLiteral})`,
            });
            continue;
          }

          const parsed = parseStaticInkConfigSource(call.arg);
          if (!parsed) {
            if (resolution === "static") {
              throw staticResolutionError(
                'resolution="static" could not statically resolve ink(...)',
                call.start,
              );
            }
            replacements.push({
              start: call.start,
              end: call.end,
              text:
                `${call.callee}(${call.arg}, undefined, ${runtimeOptionsLiteral})`,
            });
            continue;
          }

          for (const importPath of parsed.imports ?? []) {
            const browserPath = toBrowserStylesheetPath(
              importPath,
              normalizedId,
              {
                projectRoot,
                viteRoot,
                viteAliases,
                tsconfigResolver,
              },
            );
            if (browserPath) {
              importRules.add(browserPath);
              logStatic(`import -> ${browserPath}`);
            }
          }

          const classMap: Record<string, string> = {};
          const variantClassMap: Record<
            string,
            Record<string, Partial<Record<string, string>>>
          > = {};
          const variantGlobalRuleMap: Record<string, Record<string, string[]>> =
            {};
          const compiledConfig: Record<string, unknown> = {};
          if ((parsed.imports?.length ?? 0) > 0) {
            compiledConfig.imports = true;
          }

          if ((parsed.tailwindCss?.length ?? 0) > 0) {
            for (const cssBlock of parsed.tailwindCss ?? []) {
              rules.add(cssBlock);
            }
            compiledConfig.global = true;
            logStatic(`tailwind css blocks: ${parsed.tailwindCss!.length}`);
          }

          const extractedGlobalRules = {
            ...rootVarsToGlobalRules(parsed.root ?? parsed.rootVars),
            ...(parsed.global ?? {}),
          };
          if (Object.keys(extractedGlobalRules).length > 0) {
            for (
              const rule of toCssGlobalRules(extractedGlobalRules, {
                breakpoints: inkConfig.breakpoints,
                breakpointBoundary: inkConfig.breakpointBoundary,
                containers: inkConfig.containers,
                defaultUnit: inkConfig.defaultUnit,
              })
            ) {
              rules.add(rule);
            }
            compiledConfig.global = true;
            for (const selector of Object.keys(extractedGlobalRules)) {
              logStatic(`global.${selector}`);
            }
          }

          for (const [key, style] of Object.entries(parsed.base)) {
            const generatedClassName =
              hasStyleDeclarations(style.declaration) ||
                !hasTailwindClassNames(style)
                ? createClassName(key, style.declaration, normalizedId)
                : undefined;
            const classValue = resolveStyleClassValue(
              generatedClassName,
              style,
            );
            classMap[key] = classValue;
            if (!generatedClassName) {
              continue;
            }
            for (
              const rule of toCssRules(generatedClassName, style.declaration, {
                breakpoints: inkConfig.breakpoints,
                breakpointBoundary: inkConfig.breakpointBoundary,
                containers: inkConfig.containers,
                defaultUnit: inkConfig.defaultUnit,
              })
            ) {
              rules.add(rule);
            }
          }
          compiledConfig.base = classMap;
          for (const [key, className] of Object.entries(classMap)) {
            logStatic(`base.${key} -> ${className}`);
          }

          if (parsed.variant) {
            for (const [group, variants] of Object.entries(parsed.variant)) {
              const groupMap: Record<string, Partial<Record<string, string>>> =
                {};
              for (
                const [variantName, declarations] of Object.entries(variants)
              ) {
                const variantMap: Partial<Record<string, string>> = {};
                for (const [key, style] of Object.entries(declarations)) {
                  const generatedClassName =
                    hasStyleDeclarations(style.declaration) ||
                      !hasTailwindClassNames(style)
                      ? createClassName(
                        `${group}:${variantName}:${key}`,
                        style.declaration,
                        normalizedId,
                      )
                      : undefined;
                  const classValue = resolveStyleClassValue(
                    generatedClassName,
                    style,
                  );
                  variantMap[key] = classValue;
                  if (generatedClassName) {
                    for (
                      const rule of toCssRules(
                        generatedClassName,
                        style.declaration,
                        {
                          breakpoints: inkConfig.breakpoints,
                          breakpointBoundary: inkConfig.breakpointBoundary,
                          containers: inkConfig.containers,
                          defaultUnit: inkConfig.defaultUnit,
                        },
                      )
                    ) {
                      rules.add(rule);
                    }
                  }
                  logStatic(
                    `variant.${group}.${variantName}.${key} -> ${classValue}`,
                  );
                }
                groupMap[variantName] = variantMap;
              }
              variantClassMap[group] = groupMap;
            }
            compiledConfig.variant = variantClassMap;
          }

          if (parsed.variantGlobal) {
            for (
              const [group, variants] of Object.entries(parsed.variantGlobal)
            ) {
              const groupMap: Record<string, string[]> = {};
              for (
                const [variantName, declarations] of Object.entries(variants)
              ) {
                const variantRules = toCssGlobalRules(declarations, {
                  breakpoints: inkConfig.breakpoints,
                  breakpointBoundary: inkConfig.breakpointBoundary,
                  containers: inkConfig.containers,
                  defaultUnit: inkConfig.defaultUnit,
                });
                groupMap[variantName] = variantRules;
                logStatic(`variantGlobal.${group}.${variantName}`);
              }
              variantGlobalRuleMap[group] = groupMap;
            }
            compiledConfig.variantGlobal = variantGlobalRuleMap;
          }

          const runtimeConfigLiteral = toRuntimeInkConfigLiteral(parsed);
          const replacement = `${call.callee}(${runtimeConfigLiteral}, ${
            JSON.stringify(compiledConfig)
          }, ${runtimeOptionsLiteral})`;
          replacements.push({
            start: call.start,
            end: call.end,
            text: replacement,
          });
        }

        for (const decl of newInkDecls) {
          const resolvedBuilderOptionsValue = decl.optionsSource
            ? parseStaticExpression(
              decl.optionsSource,
              (identifierPath) =>
                resolveIdentifierInModule(identifierPath, normalizedId) ??
                  undefined,
            ) ?? parseStaticExpression(decl.optionsSource)
            : undefined;
          const hasStaticBuilderOptions = decl.optionsSource === undefined ||
            resolvedBuilderOptionsValue !== null;
          const resolvedBuilderOptions = parseInkBuilderOptions(
            resolvedBuilderOptionsValue,
          ) ?? { simple: decl.simple };
          const runtimeDeclaration = withRuntimeOptionsInNewInkInitializer(
            decl.constructorSource,
            decl.optionsSource,
          );

          if (resolution === "dynamic") {
            replacements.push({
              start: decl.initializerStart,
              end: decl.initializerEnd,
              text: runtimeDeclaration,
            });
            continue;
          }

          if (decl.hasAddContainerCall) {
            if (resolution === "static") {
              throw staticResolutionError(
                `resolution="static" cannot statically resolve ${decl.varName}.addContainer(...)`,
                decl.start,
              );
            }
            replacements.push({
              start: decl.initializerStart,
              end: decl.initializerEnd,
              text: runtimeDeclaration,
            });
            continue;
          }

          if (!hasStaticBuilderOptions) {
            if (resolution === "static") {
              throw staticResolutionError(
                `resolution="static" could not statically resolve options for ${decl.varName}`,
                decl.start,
              );
            }
            replacements.push({
              start: decl.initializerStart,
              end: decl.initializerEnd,
              text: runtimeDeclaration,
            });
            continue;
          }

          const configParts: Record<string, unknown> =
            resolvedBuilderOptions.simple ? { simple: true } : {};
          const importParts: unknown[] = [];
          let allParsed = true;

          for (const assignment of decl.assignments) {
            let value = parseStaticExpression(assignment.valueSource) ??
              parseStaticExpression(
                assignment.valueSource,
                (identifierPath) =>
                  resolveIdentifierInModule(identifierPath, normalizedId) ??
                    undefined,
              );
            if (value === null) {
              value = evaluateExpression(
                assignment.valueSource,
                staticResolver.buildEvalScope(
                  normalizedId,
                  undefined,
                  assignment.valueSource,
                ),
              );
            }
            if (value === null) {
              if (
                assignment.property === "base" ||
                assignment.property === "global" ||
                assignment.property === "themes" ||
                assignment.property === "fonts" ||
                assignment.property === "root" ||
                assignment.property === "rootVars" ||
                assignment.property === "variant" ||
                assignment.property === "defaults" ||
                assignment.property === "tailwind" ||
                assignment.property === "tailwindCss"
              ) {
                const partialParsed = parseInkCallArgumentsWithResolver(
                  `{ ${
                    resolvedBuilderOptions.simple ? "simple: true, " : ""
                  }${assignment.property}: ${assignment.valueSource} }`,
                  (identifierPath) =>
                    resolveIdentifierInModule(identifierPath, normalizedId) ??
                      undefined,
                  {
                    utilities: inkConfig.utilities,
                    containers: inkConfig.containers,
                    themeMode: inkConfig.themeMode,
                  },
                ) ?? parseInkCallArguments(
                  `{ ${
                    resolvedBuilderOptions.simple ? "simple: true, " : ""
                  }${assignment.property}: ${assignment.valueSource} }`,
                  {
                    utilities: inkConfig.utilities,
                    containers: inkConfig.containers,
                    themeMode: inkConfig.themeMode,
                  },
                );

                if (partialParsed) {
                  const parsedRoot = partialParsed.root ??
                    partialParsed.rootVars;
                  if (assignment.property === "base") {
                    configParts.base = partialParsed.base;
                  } else if (assignment.property === "global") {
                    configParts.global = partialParsed.global ?? {};
                  } else if (
                    assignment.property === "themes" &&
                    Object.keys(partialParsed.global ?? {}).length > 0
                  ) {
                    configParts.global = {
                      ...(configParts.global as Record<string, unknown> ?? {}),
                      ...(partialParsed.global as Record<string, unknown>),
                    };
                    if (parsedRoot) {
                      configParts.root = [
                        ...((configParts.root as unknown[]) ?? []),
                        ...parsedRoot,
                      ];
                    }
                  } else if (
                    (assignment.property === "root" ||
                      assignment.property === "rootVars") &&
                    parsedRoot
                  ) {
                    configParts.root = parsedRoot;
                  } else if (
                    (assignment.property === "themes" ||
                      assignment.property === "fonts") &&
                    parsedRoot
                  ) {
                    configParts.root = [
                      ...((configParts.root as unknown[]) ?? []),
                      ...parsedRoot,
                    ];
                  } else if (
                    assignment.property === "variant" && partialParsed.variant
                  ) {
                    configParts.variant = partialParsed.variant;
                  } else if (
                    assignment.property === "defaults" && partialParsed.defaults
                  ) {
                    configParts.defaults = partialParsed.defaults;
                  } else if (
                    assignment.property === "tailwindCss" &&
                    partialParsed.tailwindCss
                  ) {
                    configParts.tailwindCss = partialParsed.tailwindCss;
                  } else if (assignment.property === "tailwind") {
                    configParts.tailwind = partialParsed.tailwind;
                  }
                  if ((partialParsed.imports?.length ?? 0) > 0) {
                    importParts.push(partialParsed.imports!);
                  }
                  continue;
                }
              }

              allParsed = false;
              break;
            }

            if (assignment.property === "import") {
              importParts.push(value);
            } else if (assignment.property === "importModule") {
              configParts.modules = {
                ...(configParts.modules as Record<string, string> ?? {}),
                ...(value as Record<string, string>),
              };
            } else {
              configParts[
                assignment.property === "rootVars"
                  ? "root"
                  : assignment.property
              ] = value;
            }
          }

          if (importParts.length > 0) {
            const ensureGlobal = (): Record<string, unknown> => {
              configParts.global = configParts.global ?? {};
              return configParts.global as Record<string, unknown>;
            };

            for (const entryGroup of importParts) {
              const entries = Array.isArray(entryGroup)
                ? entryGroup
                : [entryGroup];
              for (const entry of entries) {
                if (
                  typeof entry === "object" && entry !== null &&
                  !Array.isArray(entry) && "tailwind" in entry
                ) {
                  const currentTailwind = configParts.tailwind;
                  configParts.tailwind = currentTailwind === undefined
                    ? (entry as { tailwind: unknown }).tailwind
                    : [
                      ...(Array.isArray(currentTailwind)
                        ? currentTailwind
                        : [currentTailwind]),
                      (entry as { tailwind: unknown }).tailwind,
                    ];
                  continue;
                }

                if (
                  typeof entry === "string" ||
                  (typeof entry === "object" && entry !== null &&
                    "path" in entry)
                ) {
                  const currentGlobal = ensureGlobal();
                  currentGlobal["@import"] = currentGlobal["@import"] ?? [];
                  if (Array.isArray(currentGlobal["@import"])) {
                    currentGlobal["@import"].push(entry);
                  } else {
                    currentGlobal["@import"] = [
                      currentGlobal["@import"],
                      entry,
                    ];
                  }
                } else if (typeof entry === "object" && entry !== null) {
                  if ("rules" in entry) {
                    const ruleObj = entry as { layer?: string; rules: unknown };
                    if (ruleObj.layer && typeof ruleObj.layer === "string") {
                      const currentGlobal = ensureGlobal();
                      currentGlobal[`@layer ${ruleObj.layer}`] = ruleObj.rules;
                    } else if (
                      ruleObj.rules && typeof ruleObj.rules === "object"
                    ) {
                      const currentGlobal = ensureGlobal();
                      Object.assign(currentGlobal, ruleObj.rules);
                    }
                  } else {
                    const currentGlobal = ensureGlobal();
                    Object.assign(currentGlobal, entry);
                  }
                }
              }
            }
          }

          if (!allParsed) {
            if (resolution === "static") {
              throw staticResolutionError(
                `resolution="static" could not statically resolve assignments for ${decl.varName}`,
                decl.start,
              );
            }
            replacements.push({
              start: decl.initializerStart,
              end: decl.initializerEnd,
              text: runtimeDeclaration,
            });
            continue;
          }

          const parsed = parseInkConfig(configParts, {
            utilities: inkConfig.utilities,
            containers: inkConfig.containers,
            themeMode: inkConfig.themeMode,
          });
          if (!parsed) {
            if (resolution === "static") {
              throw staticResolutionError(
                `resolution="static" could not statically resolve config for ${decl.varName}`,
                decl.start,
              );
            }
            replacements.push({
              start: decl.initializerStart,
              end: decl.initializerEnd,
              text: runtimeDeclaration,
            });
            continue;
          }

          for (const importPath of parsed.imports ?? []) {
            const browserPath = toBrowserStylesheetPath(
              importPath,
              normalizedId,
              {
                projectRoot,
                viteRoot,
                viteAliases,
                tsconfigResolver,
              },
            );
            if (browserPath) {
              importRules.add(browserPath);
              logStatic(`import -> ${browserPath}`);
            }
          }

          const classMap: Record<string, string> = {};
          const variantClassMap: Record<
            string,
            Record<string, Partial<Record<string, string>>>
          > = {};
          const variantGlobalRuleMap: Record<string, Record<string, string[]>> =
            {};
          const compiledConfig: Record<string, unknown> = {};
          if ((parsed.imports?.length ?? 0) > 0) {
            compiledConfig.imports = true;
          }

          if ((parsed.tailwindCss?.length ?? 0) > 0) {
            for (const cssBlock of parsed.tailwindCss ?? []) {
              rules.add(cssBlock);
            }
            compiledConfig.global = true;
            logStatic(`tailwind css blocks: ${parsed.tailwindCss!.length}`);
          }

          const extractedGlobalRules = {
            ...rootVarsToGlobalRules(parsed.root ?? parsed.rootVars),
            ...(parsed.global ?? {}),
          };
          if (Object.keys(extractedGlobalRules).length > 0) {
            for (
              const rule of toCssGlobalRules(extractedGlobalRules, {
                breakpoints: inkConfig.breakpoints,
                breakpointBoundary: inkConfig.breakpointBoundary,
                containers: inkConfig.containers,
                defaultUnit: inkConfig.defaultUnit,
              })
            ) {
              rules.add(rule);
            }
            compiledConfig.global = true;
            for (const selector of Object.keys(extractedGlobalRules)) {
              logStatic(`global.${selector}`);
            }
          }

          for (const [key, style] of Object.entries(parsed.base)) {
            const generatedClassName =
              hasStyleDeclarations(style.declaration) ||
                !hasTailwindClassNames(style)
                ? createClassName(key, style.declaration, normalizedId)
                : undefined;
            const classValue = resolveStyleClassValue(
              generatedClassName,
              style,
            );
            classMap[key] = classValue;
            if (!generatedClassName) {
              continue;
            }
            for (
              const rule of toCssRules(generatedClassName, style.declaration, {
                breakpoints: inkConfig.breakpoints,
                breakpointBoundary: inkConfig.breakpointBoundary,
                containers: inkConfig.containers,
                defaultUnit: inkConfig.defaultUnit,
              })
            ) {
              rules.add(rule);
            }
          }
          compiledConfig.base = classMap;
          for (const [key, className] of Object.entries(classMap)) {
            logStatic(`base.${key} -> ${className}`);
          }

          if (parsed.variant) {
            for (const [group, variants] of Object.entries(parsed.variant)) {
              const groupMap: Record<string, Partial<Record<string, string>>> =
                {};
              for (
                const [variantName, declarations] of Object.entries(variants)
              ) {
                const variantMap: Partial<Record<string, string>> = {};
                for (const [key, style] of Object.entries(declarations)) {
                  const generatedClassName =
                    hasStyleDeclarations(style.declaration) ||
                      !hasTailwindClassNames(style)
                      ? createClassName(
                        `${group}:${variantName}:${key}`,
                        style.declaration,
                        normalizedId,
                      )
                      : undefined;
                  const classValue = resolveStyleClassValue(
                    generatedClassName,
                    style,
                  );
                  variantMap[key] = classValue;
                  if (generatedClassName) {
                    for (
                      const rule of toCssRules(
                        generatedClassName,
                        style.declaration,
                        {
                          breakpoints: inkConfig.breakpoints,
                          breakpointBoundary: inkConfig.breakpointBoundary,
                          containers: inkConfig.containers,
                          defaultUnit: inkConfig.defaultUnit,
                        },
                      )
                    ) {
                      rules.add(rule);
                    }
                  }
                  logStatic(
                    `variant.${group}.${variantName}.${key} -> ${classValue}`,
                  );
                }
                groupMap[variantName] = variantMap;
              }
              variantClassMap[group] = groupMap;
            }
            compiledConfig.variant = variantClassMap;
          }

          if (parsed.variantGlobal) {
            for (
              const [group, variants] of Object.entries(parsed.variantGlobal)
            ) {
              const groupMap: Record<string, string[]> = {};
              for (
                const [variantName, declarations] of Object.entries(variants)
              ) {
                const variantRules = toCssGlobalRules(declarations, {
                  breakpoints: inkConfig.breakpoints,
                  breakpointBoundary: inkConfig.breakpointBoundary,
                  containers: inkConfig.containers,
                  defaultUnit: inkConfig.defaultUnit,
                });
                groupMap[variantName] = variantRules;
                logStatic(`variantGlobal.${group}.${variantName}`);
              }
              variantGlobalRuleMap[group] = groupMap;
            }
            compiledConfig.variantGlobal = variantGlobalRuleMap;
          }

          if (parsed.modules) {
            compiledConfig.modules = parsed.modules;
          }

          const runtimeConfigLiteral = toRuntimeInkConfigLiteral(parsed);
          const inkCall = `${decl.constructorSource}(${runtimeConfigLiteral}, ${
            JSON.stringify(compiledConfig)
          }, ${runtimeOptionsLiteral})`;
          replacements.push({
            start: decl.initializerStart,
            end: decl.initializerEnd,
            text: inkCall,
          });

          for (const assignment of decl.assignments) {
            replacements.push({
              start: assignment.start,
              end: assignment.end,
              text: "",
            });
          }
        }

        if (replacements.length === 0) {
          return null;
        }

        replacements.sort((a, b) => b.start - a.start);

        for (const replacement of replacements) {
          nextCode = nextCode.slice(0, replacement.start) +
            replacement.text +
            nextCode.slice(replacement.end);
        }

        if (!isSvelte && !isAstro) {
          nextCode = stripUnusedStaticHelperConsts(nextCode, normalizedId);
        }
        const needsTailwindRuntimeImport =
          nextCode.includes('"tailwindClassNames"') ||
          /\btw\s*\(/.test(nextCode);
        managedModules.add(normalizedId);
        updateModuleStaticDependencies(normalizedId, staticDependencies);
        addWatchFiles(this, staticDependencies);

        let didVirtualCssChange = false;
        let scopedVirtualImport: string | null = null;

        if (isSvelte) {
          nextCode = addVirtualImportToSvelte(nextCode);
          if (needsTailwindRuntimeImport) {
            nextCode = addVirtualImportToSvelte(
              nextCode,
              PUBLIC_TAILWIND_RUNTIME_ID,
            );
          }
          const nextImports = Array.from(importRules);
          const prevImports = moduleImports.get(normalizedId) ?? [];
          const importsChanged = nextImports.length !== prevImports.length ||
            nextImports.some((entry, index) => entry !== prevImports[index]);
          if (importsChanged) {
            if (nextImports.length > 0) {
              moduleImports.set(normalizedId, nextImports);
            } else {
              moduleImports.delete(normalizedId);
            }
            didVirtualCssChange = true;
          }

          const nextCss = mergeCss(rules);
          const prevCss = moduleCss.get(normalizedId) ?? "";
          if (prevCss !== nextCss) {
            if (nextCss.length > 0) {
              moduleCss.set(normalizedId, nextCss);
            } else {
              moduleCss.delete(normalizedId);
            }
            didVirtualCssChange = true;
          }

          if (nextImports.length > 0 || nextCss.length > 0) {
            scopedVirtualImport = moduleVirtualImportId(normalizedId);
          }
        } else {
          nextCode = isAstro
            ? addVirtualImportToAstro(nextCode)
            : addVirtualImport(nextCode);
          if (needsTailwindRuntimeImport) {
            nextCode = isAstro
              ? addVirtualImportToAstro(nextCode, PUBLIC_TAILWIND_RUNTIME_ID)
              : addVirtualImport(nextCode, PUBLIC_TAILWIND_RUNTIME_ID);
          }
          const nextImports = Array.from(importRules);
          const prevImports = moduleImports.get(normalizedId) ?? [];
          const importsChanged = nextImports.length !== prevImports.length ||
            nextImports.some((entry, index) => entry !== prevImports[index]);
          if (importsChanged) {
            if (nextImports.length > 0) {
              moduleImports.set(normalizedId, nextImports);
            } else {
              moduleImports.delete(normalizedId);
            }
            didVirtualCssChange = true;
          }

          const nextCss = mergeCss(rules);
          const prevCss = moduleCss.get(normalizedId) ?? "";
          if (prevCss !== nextCss) {
            if (nextCss.length > 0) {
              moduleCss.set(normalizedId, nextCss);
            } else {
              moduleCss.delete(normalizedId);
            }
            didVirtualCssChange = true;
          }

          if (nextImports.length > 0 || nextCss.length > 0) {
            scopedVirtualImport = moduleVirtualImportId(normalizedId);
          }
        }

        if (scopedVirtualImport) {
          nextCode = isSvelte
            ? addVirtualImportToSvelte(nextCode, scopedVirtualImport)
            : isAstro
            ? addModuleVirtualImportToAstro(nextCode, scopedVirtualImport)
            : addVirtualImport(nextCode, scopedVirtualImport);
        }
        if (didVirtualCssChange) {
          invalidateVirtualModules(scopedVirtualImport ? [normalizedId] : []);
        }

        return {
          code: nextCode,
          map: null,
        };
      };

      const hasImportModule = /\.importModule\s*\(/.test(code);
      if (hasImportModule) {
        return (async () => {
          const currentModuleInfo = getModuleInfo(normalizedId);
          if (currentModuleInfo && this?.load) {
            for (const decl of newInkDecls) {
              for (const assign of decl.assignments) {
                if (assign.property === "importModule") {
                  const binding = currentModuleInfo.imports.get(
                    assign.valueSource.trim(),
                  );
                  if (
                    binding &&
                    (binding.source.includes(".module.css") ||
                      binding.source.includes(".module.scss") ||
                      binding.source.includes(".module.sass") ||
                      binding.source.includes(".module.less"))
                  ) {
                    const resolvedImportFile = resolveImportToFile(
                      normalizedId,
                      binding.source,
                      importResolverOptions,
                    );
                    if (resolvedImportFile) {
                      try {
                        const loaded = await this.load({
                          id: resolvedImportFile,
                        });
                        if (loaded && loaded.code) {
                          const cssModuleInfo = parseStaticModuleInfo(
                            loaded.code,
                            resolvedImportFile,
                          );
                          moduleInfoCache.set(
                            resolvedImportFile,
                            cssModuleInfo,
                          );
                          if (cssModuleInfo.defaultExportExpression) {
                            const defaultExpression =
                              cssModuleInfo.defaultExportExpression;
                            const parsedMapping = parseStaticExpression(
                              defaultExpression,
                              (nestedPath) =>
                                resolveIdentifierInModule(
                                  nestedPath,
                                  resolvedImportFile,
                                ) ?? undefined,
                            ) ?? evaluateExpression(
                              defaultExpression,
                              staticResolver.buildEvalScope(
                                resolvedImportFile,
                                undefined,
                                defaultExpression,
                              ),
                            );
                            if (
                              parsedMapping && typeof parsedMapping === "object"
                            ) {
                              cssModuleMappings.set(
                                assign.valueSource.trim(),
                                parsedMapping as Record<string, string>,
                              );
                            }
                          }
                        }
                      } catch {
                        // ignore and proceed
                      }
                    }
                  }
                }
              }
            }
          }
          return runSync();
        })();
      } else {
        return runSync();
      }
    },

    handleHotUpdate(ctx: { file: string; timestamp?: number }) {
      const normalizedId = cleanId(ctx.file);
      const affectedModules = new Set<unknown>();
      const graphInvalidated = new Set<unknown>();
      const configChanged = (inkConfig.path &&
        normalizedId === cleanId(inkConfig.path)) ||
        inkConfig.dependencies.includes(normalizedId);
      if (configChanged) {
        inkConfig = loadInkConfig(viteRoot, {
          projectRoot,
          viteRoot,
          viteAliases,
          tsconfigResolver,
        });
        for (
          const module of invalidateManagedModules(
            managedModules,
            ctx.timestamp,
            graphInvalidated,
          )
        ) {
          affectedModules.add(module);
        }
        return affectedModules.size > 0
          ? Array.from(affectedModules)
          : undefined;
      }

      const affectedOwners = dependencyOwners.get(normalizedId);
      if (affectedOwners && affectedOwners.size > 0) {
        for (
          const module of invalidateManagedModules(
            affectedOwners,
            ctx.timestamp,
            graphInvalidated,
          )
        ) {
          affectedModules.add(module);
        }
      }

      if (clearManagedModuleState(normalizedId)) {
        for (
          const module of invalidateVirtualModules(
            [normalizedId],
            ctx.timestamp,
            graphInvalidated,
          )
        ) {
          affectedModules.add(module);
        }
        for (
          const module of invalidateModulesByFile(
            normalizedId,
            ctx.timestamp,
            graphInvalidated,
          )
        ) {
          affectedModules.add(module);
        }
      }

      return affectedModules.size > 0 ? Array.from(affectedModules) : undefined;
    },
  };
}

/** Default export for {@link inkVite}. */
export default inkVite;
