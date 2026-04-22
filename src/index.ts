/**
 * Ink public API entrypoint.
 * @module
 */
import runtimeInk from "./runtime.js";
import type {
  InkBuilder,
  InkBuilderOptions,
  InkSimpleBuilder,
} from "./runtime.js";
import { inkVite } from "./vite.js";
import { cVar, font, Theme, tVar, tw } from "./shared.js";

type Ink = typeof runtimeInk & {
  new (): InkBuilder;
  new (options: InkBuilderOptions & { simple: true }): InkSimpleBuilder;
  vite: typeof inkVite;
  cVar: typeof cVar;
  font: typeof font;
  Theme: typeof Theme;
  tw: typeof tw;
  tVar: typeof tVar;
};

/**
 * Primary API for defining styles with Ink.
 *
 * Includes `ink.vite` for the Vite plugin and `ink.cVar` for CSS variables.
 */
const ink = Object.assign(runtimeInk, {
  vite: inkVite,
  cVar,
  font,
  Theme,
  tw,
  tVar,
}) as Ink;

/** Default export for the Ink runtime API. */
export default ink;
/** Named export for the Vite plugin. */
export { inkVite, inkVite as vite };
/** Named export for creating CSS variable references. */
export { cVar };
/** Named export for creating quoted `font-family` lists. */
export { font };
/** Named export for defining theme token maps. */
export { Theme };
/** Named export for Tailwind-aware class markers. */
export { tw };
/** Named export for referencing theme-backed CSS variables. */
export { tVar };
/** Re-exported Vite plugin options. */
export type { InkVitePluginOptions } from "./vite.js";
/** Re-exported builder type. */
export type {
  InkBuilder,
  InkBuilderOptions,
  InkSimpleBuilder,
  InkSimpleConfig,
  InkSimpleStyleAccessor,
} from "./runtime.js";
/** Style object for a single class name. */
export type { StyleDeclaration } from "./shared.js";
/** Map of class keys to their style declarations. */
export type { StyleSheet } from "./shared.js";
/** CSS value accepted by style declarations. */
export type { StyleValue } from "./shared.js";
/** Fontsource font entry accepted by `fonts`. */
export type { FontSourceInput } from "./shared.js";
/** Callable font helper type. */
export type { FontHelper } from "./shared.js";
/** Input accepted by the `@apply` directive. */
export type { ApplyInput } from "./shared.js";
/** Input accepted by the `@set` directive. */
export type { SetInput } from "./shared.js";
/** Valid input for importing external styles or global style objects. */
export type { ImportInput } from "./shared.js";
/** Tailwind class marker returned by `tw(...)`. */
export type { TailwindClassValue } from "./shared.js";
/** Input accepted by `tw(...)`. */
export type { TailwindClassInput } from "./shared.js";
/** Layered `@apply` helper object. */
export type { LayeredApplyInput } from "./shared.js";
/** Object form accepted by the `@set` directive. */
export type { ContainerSetInput } from "./shared.js";
/** Theme token map accepted by `new Theme(...)`. */
export type { ThemeTokenInput } from "./shared.js";
/** Theme map accepted by `themes`. */
export type { ImportedThemesInput } from "./shared.js";
