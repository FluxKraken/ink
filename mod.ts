/**
 * Deno/JSR entrypoint for the Ink public API.
 * @module
 */
/** Default export for the Ink runtime API. */
export { default } from "./src/index.ts";
/** Named export for the Vite plugin. */
export { inkVite, vite } from "./src/index.ts";
/** Named export for creating CSS variable references. */
export { cVar } from "./src/index.ts";
/** Named export for creating quoted `font-family` lists. */
export { font } from "./src/index.ts";
/** Named export for marking image assets for `url(...)` serialization. */
export { image } from "./src/index.ts";
/** Named export for defining theme token maps. */
export { Theme } from "./src/index.ts";
/** Named export for defining themes with explicit selectors. */
export { ThemeAdvanced } from "./src/index.ts";
/** Named export for Tailwind-aware class markers. */
export { tw } from "./src/index.ts";
/** Named export for referencing theme-backed CSS variables. */
export { tVar } from "./src/index.ts";
/** Named export for typing `ink.config.ts` files. */
export { defineInkConfig } from "./src/index.ts";
/** Backwards-compatible config helper alias. Prefer `defineInkConfig`. */
export { defineCssConfig } from "./src/index.ts";
/** Re-exported Vite plugin options type. */
export type { InkVitePluginOptions } from "./src/index.ts";
/** Style object for a single class name. */
export type { StyleDeclaration } from "./src/index.ts";
/** Builder type for incremental multi-slot styles. */
export type { InkBuilder } from "./src/index.ts";
/** Builder constructor options. */
export type { InkBuilderOptions } from "./src/index.ts";
/** Builder type for single-slot shorthand styles. */
export type { InkSimpleBuilder } from "./src/index.ts";
/** Config shape for single-slot shorthand styles. */
export type { InkSimpleConfig } from "./src/index.ts";
/** Accessor type returned by shorthand styles. */
export type { InkSimpleStyleAccessor } from "./src/index.ts";
/** Map of class keys to their style declarations. */
export type { StyleSheet } from "./src/index.ts";
/** CSS value accepted by style declarations. */
export type { StyleValue } from "./src/index.ts";
/** Explicit image asset value returned by `image(...)`. */
export type { ImageValue } from "./src/index.ts";
/** Object form accepted by `fontVariationSettings`. */
export type { FontVariationSettingsObject } from "./src/index.ts";
/** Fontsource font entry accepted by `fonts`. */
export type { FontSourceInput } from "./src/index.ts";
/** Callable font helper type. */
export type { FontHelper } from "./src/index.ts";
/** Input accepted by the `@apply` directive. */
export type { ApplyInput } from "./src/index.ts";
/** Input accepted by the `@set` directive. */
export type { SetInput } from "./src/index.ts";
/** Valid input for importing external styles or global style objects. */
export type { ImportInput } from "./src/index.ts";
/** Tailwind CSS config object accepted by `.import({ tailwind })`. */
export type { TailwindConfigInput } from "./src/index.ts";
/** Tailwind CSS import entries accepted by `TailwindConfigInput.import`. */
export type { TailwindConfigImportInput } from "./src/index.ts";
/** Tailwind CSS plugin entries accepted by `TailwindConfigInput.plugin`. */
export type { TailwindConfigPluginInput } from "./src/index.ts";
/** Tailwind class marker returned by `tw(...)`. */
export type { TailwindClassValue } from "./src/index.ts";
/** Input accepted by `tw(...)`. */
export type { TailwindClassInput } from "./src/index.ts";
/** Layered `@apply` helper object. */
export type { LayeredApplyInput } from "./src/index.ts";
/** Object form accepted by the `@set` directive. */
export type { ContainerSetInput } from "./src/index.ts";
/** Theme token map accepted by `new Theme(...)`. */
export type { ThemeTokenInput } from "./src/index.ts";
/** Advanced theme input accepted by `new ThemeAdvanced(...)`. */
export type { ThemeAdvancedInput } from "./src/index.ts";
/** Theme expansion strategy used for imported themes. */
export type { ThemeMode } from "./src/index.ts";
/** Store-like value that can drive `themeMode: "store"`. */
export type { ThemeStore, ThemeStoreUnsubscribe } from "./src/index.ts";
/** Theme map accepted by `themes`. */
export type { ImportedThemesInput } from "./src/index.ts";
/** Theme map accepted by `themeMode: "store"`, including `default`. */
export type { StoreThemesInput } from "./src/index.ts";
/** Project-wide config shape accepted by `ink.config.ts`. */
export type { InkConfigFile } from "./src/index.ts";
/** Style resolution mode used by the Vite plugin. */
export type { InkResolution } from "./src/index.ts";
/** Persistence metadata used to restore a store-backed theme before paint. */
export type { InkThemeBootstrapOptions } from "./src/index.ts";
