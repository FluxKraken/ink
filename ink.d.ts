/**
 * Opt-in ambient types for consuming TypeScript projects.
 *
 * Do not reference this file from a JSR export: JSR rejects global module
 * declarations in a published entrypoint's type graph.
 */
declare module "*.ink" {
  /**
   * `.ink` source can export styles, tokens, themes, and helpers. Its exact
   * shape is known only after the Vite transform runs.
   */
  const module: Record<string, any>;
  export default module;
}
