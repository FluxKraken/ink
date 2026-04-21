import {
  ApplyInput,
  ContainerSetInput,
  CssVarRef,
  font,
  ImportedThemesInput,
  LayeredApplyInput,
  PrimitiveStyleValue,
  SetInput,
  StyleDeclaration,
  StyleSheet,
  StyleValue,
  TailwindClassInput,
  TailwindClassValue,
  Theme,
  ThemeTokenInput,
  tw,
} from "./dist/shared.d.ts";
import type { InkVitePluginOptions } from "./dist/vite.d.ts";

type StyleDeclarationInput =
  | StyleDeclaration
  | TailwindClassValue
  | readonly StyleDeclarationInput[];
type StyleSheetInput = Record<string, StyleDeclarationInput>;
type RootVarInput =
  | Record<string, StyleValue>
  | {
    vars: Record<string, StyleValue>;
    layer?: string;
  };
type CompiledMap<T extends StyleSheetInput> = Partial<Record<keyof T, string>>;
type VariantSheet<T extends StyleSheetInput> = Record<
  string,
  Record<string, Partial<T>>
>;
type VariantClassMap<T extends StyleSheetInput> = Record<
  string,
  Record<string, Partial<Record<keyof T, string>>>
>;
type BooleanVariantKey = "true" | "false";
type VariantSelectionValue<K> = K extends string
  ? string extends K ? string | boolean
  : K extends BooleanVariantKey ? boolean
  : K
  : K;
type InkConfig<
  T extends StyleSheetInput,
  V extends VariantSheet<T> | undefined,
> = {
  global?: StyleSheetInput;
  themes?: ImportedThemesInput;
  root?: readonly RootVarInput[];
  /** @deprecated Use `root` instead. */
  rootVars?: readonly RootVarInput[];
  base?: T;
  variant?: V;
  defaults?: VariantSelection<V>;
};
type SimpleVariantSheet = Record<string, Record<string, StyleDeclarationInput>>;
type SimpleVariantSelection<V extends SimpleVariantSheet | undefined> =
  V extends SimpleVariantSheet
    ? { [G in keyof V]?: VariantSelectionValue<keyof V[G]> }
    : Record<string, string | boolean>;
type InkSimpleConfig<V extends SimpleVariantSheet | undefined> = {
  simple: true;
  global?: StyleSheetInput;
  themes?: ImportedThemesInput;
  root?: readonly RootVarInput[];
  /** @deprecated Use `root` instead. */
  rootVars?: readonly RootVarInput[];
  base?: StyleDeclarationInput;
  variant?: V;
  defaults?: SimpleVariantSelection<V>;
};
type InkRuntimeOptions = {
  breakpoints?: Record<string, string>;
  containers?: Record<string, { type?: string; rule: string }>;
  layers?: readonly string[];
  defaultUnit?: string;
  utilities?: StyleSheetInput;
  resolution?: "static" | "dynamic" | "hybrid";
  debug?: {
    enabled?: boolean;
    logDynamic?: boolean;
    logStatic?: boolean;
  };
};
type CompiledConfig<T extends StyleSheetInput> = {
  imports?: true;
  global?: true;
  base?: CompiledMap<T>;
  variant?: VariantClassMap<T>;
};
type VariantSelection<V extends VariantSheet<any> | undefined> = V extends
  VariantSheet<any> ? { [G in keyof V]?: VariantSelectionValue<keyof V[G]> }
  : Record<string, string | boolean>;
type Accessor<
  T extends StyleSheetInput,
  V extends VariantSheet<T> | undefined,
> = {
  [K in keyof T]: StyleAccessor<V>;
};
type StyleAccessor<V extends VariantSheet<any> | undefined> =
  & ((variants?: VariantSelection<V>) => string)
  & {
    class: (variants?: VariantSelection<V>) => string;
    style: (variants?: VariantSelection<V>) => string;
  };
type InkSimpleStyleAccessor<V extends SimpleVariantSheet | undefined> =
  & ((variants?: SimpleVariantSelection<V>) => string)
  & {
    class: (variants?: SimpleVariantSelection<V>) => string;
    style: (variants?: SimpleVariantSelection<V>) => string;
  };
type InkBuilderOptions = {
  simple?: boolean;
};
type InkBuilder<
  T extends StyleSheetInput,
  V extends VariantSheet<T> | undefined,
> =
  & (() => Accessor<T, V>)
  & Accessor<T, V>
  & {
    base: T | undefined;
    global: StyleSheetInput | undefined;
    themes: ImportedThemesInput | undefined;
    root: readonly RootVarInput[] | undefined;
    /** @deprecated Use `root` instead. */
    rootVars: readonly RootVarInput[] | undefined;
    variant: V | undefined;
    defaults: VariantSelection<V> | undefined;
    addContainer: (
      container: {
        name: string;
        type?: string;
        rule: string;
      },
    ) => InkBuilder<T, V>;
    import: (
      inputs: import("./dist/shared.d.ts").ImportInput,
    ) => InkBuilder<T, V>;
  };
type InkSimpleBuilder<V extends SimpleVariantSheet | undefined> =
  & InkSimpleStyleAccessor<V>
  & {
    base: StyleDeclarationInput | undefined;
    global: StyleSheetInput | undefined;
    themes: ImportedThemesInput | undefined;
    root: readonly RootVarInput[] | undefined;
    /** @deprecated Use `root` instead. */
    rootVars: readonly RootVarInput[] | undefined;
    variant: V | undefined;
    defaults: SimpleVariantSelection<V> | undefined;
    addContainer: (
      container: {
        name: string;
        type?: string;
        rule: string;
      },
    ) => InkSimpleBuilder<V>;
    import: (
      inputs: import("./dist/shared.d.ts").ImportInput,
    ) => InkSimpleBuilder<V>;
  };

/** Re-exported Vite plugin options. */
export type { InkVitePluginOptions };
/** Re-exported style declaration type. */
export type { StyleDeclaration };
/** Re-exported multi-slot builder type. */
export type { InkBuilder };
/** Re-exported builder options type. */
export type { InkBuilderOptions };
/** Re-exported shorthand builder type. */
export type { InkSimpleBuilder };
/** Re-exported shorthand config type. */
export type { InkSimpleConfig };
/** Re-exported shorthand accessor type. */
export type { InkSimpleStyleAccessor };
/** Re-exported style sheet type. */
export type { StyleSheet };
/** Re-exported style value type. */
export type { StyleValue };
/** Input accepted by the `@apply` directive. */
export type { ApplyInput };
/** Input accepted by the `@set` directive. */
export type { SetInput };
/** Tailwind class marker returned by `tw(...)`. */
export type { TailwindClassValue };
/** Input accepted by `tw(...)`. */
export type { TailwindClassInput };
/** Layered `@apply` helper object. */
export type { LayeredApplyInput };
/** Object form accepted by the `@set` directive. */
export type { ContainerSetInput };
/** Re-exported theme token input type. */
export type { ThemeTokenInput };
/** Re-exported imported theme map type. */
export type { ImportedThemesInput };
/** Re-exported Theme constructor. */
export { Theme };

/** Combined Ink runtime API. */
export interface Ink {
  <
    T extends StyleSheetInput = StyleSheetInput,
    V extends VariantSheet<T> | undefined = VariantSheet<T> | undefined,
  >(
    config: InkConfig<T, V>,
    compiled?: CompiledConfig<T>,
    runtimeOptions?: InkRuntimeOptions,
  ): () => Accessor<T, V>;
  <
    V extends SimpleVariantSheet | undefined = SimpleVariantSheet | undefined,
  >(
    config: InkSimpleConfig<V>,
    compiled?: CompiledConfig<Record<string, StyleDeclarationInput>>,
    runtimeOptions?: InkRuntimeOptions,
  ): InkSimpleStyleAccessor<V>;
  new <
    T extends StyleSheetInput = StyleSheetInput,
    V extends VariantSheet<T> | undefined = VariantSheet<T> | undefined,
  >(): InkBuilder<T, V>;
  new (options: InkBuilderOptions & { simple: true }): InkSimpleBuilder<any>;
  /** Vite plugin entry point. */
  vite: (options?: InkVitePluginOptions) => any;
  /** Create a CSS variable reference. */
  cVar: (name: string, fallback?: PrimitiveStyleValue) => CssVarRef;
  /** Create a quoted `font-family` list. */
  font: typeof font;
  /** Theme constructor. */
  Theme: typeof Theme;
  /** Tailwind class helper. */
  tw: typeof tw;
  /** Theme variable proxy. */
  tVar: Record<string, CssVarRef>;
}

/** Default export for the Ink runtime API. */
declare const ink: Ink;
export default ink;
/** Named export for the Vite plugin. */
export const inkVite: (options?: InkVitePluginOptions) => any;
/** Named export for the Vite plugin. */
export const vite: (options?: InkVitePluginOptions) => any;
/** Named export for creating CSS variable references. */
export const cVar: (name: string, fallback?: PrimitiveStyleValue) => CssVarRef;
/** Named export for creating quoted `font-family` lists. */
export { font };
/** Named export for defining theme token maps. */
export { Theme };
/** Named export for Tailwind-aware class markers. */
export { tw };
/** Named export for referencing theme-backed CSS variables. */
export const tVar: Record<string, CssVarRef>;
