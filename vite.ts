/**
 * Deno/JSR entrypoint for the Ink Vite plugin.
 * @module
 */
import { inkVite } from "./src/vite.ts";

/** Default export for the Ink Vite plugin. */
export default inkVite;
/** Named export for the Ink Vite plugin. */
export { inkVite };
/** Named export for the Ink Vite plugin. */
export const vite = inkVite;
/** Re-exported Vite plugin options. */
export type { InkVitePluginOptions } from "./src/vite.ts";
