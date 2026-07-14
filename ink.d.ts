declare module "*.ink" {
  /**
   * `.ink` source can export styles, tokens, themes, and helpers. Its exact
   * shape is known only after the Vite transform runs.
   */
  const module: Record<string, any>;
  export default module;
}
