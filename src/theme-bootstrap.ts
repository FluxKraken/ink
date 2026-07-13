import type { InkThemeBootstrapOptions } from "./shared.js";

/** Normalized persistence metadata used by Ink's pre-paint theme bootstrap. */
export type ThemeBootstrapConfig = InkThemeBootstrapOptions;

const ROOT_THEME_NAMES = new Set(["default", "root", ":root"]);

/**
 * Serialize compiler-owned data for an inline script element.
 *
 * Escaping `<` prevents a value containing `</script>` from terminating the
 * element. U+2028 and U+2029 are escaped explicitly for JavaScript parsers
 * that still treat them as source line terminators.
 */
function toInlineScriptLiteral(value: string | readonly string[]): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError("Unable to serialize Ink theme bootstrap data");
  }
  return serialized
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Generate the synchronous script that restores a persisted theme pre-paint.
 *
 * The returned source is self-contained and does not import Ink, the theme
 * store, or any framework runtime. Root/default and unknown values remove the
 * attribute so the CSS emitted on `:root` remains authoritative.
 */
export function generateThemeBootstrapScript(
  config: ThemeBootstrapConfig,
  themeNames: readonly string[],
): string {
  const storage = config.storage ?? "localStorage";
  const deserialize = config.deserialize ?? "json";
  if (storage !== "localStorage" && storage !== "sessionStorage") {
    throw new TypeError(`Unsupported theme bootstrap storage: ${storage}`);
  }
  if (deserialize !== "json" && deserialize !== "raw") {
    throw new TypeError(
      `Unsupported theme bootstrap deserializer: ${deserialize}`,
    );
  }

  const alternatives = Array.from(
    new Set(
      themeNames
        .map((name) => name.trim())
        .filter((name) => name !== "" && !ROOT_THEME_NAMES.has(name)),
    ),
  );
  const key = toInlineScriptLiteral(config.key);
  const allowedThemes = toInlineScriptLiteral(alternatives);
  const deserializeStored = deserialize === "raw"
    ? "const value=stored;"
    : "const value=stored===null?null:JSON.parse(stored);";

  return `(()=>{const root=document.documentElement;try{const stored=${storage}.getItem(${key});${deserializeStored}const candidate=typeof value==="string"?value.trim():"";if(${allowedThemes}.includes(candidate)){root.setAttribute("data-ink-theme",candidate)}else{root.removeAttribute("data-ink-theme")}}catch{root.removeAttribute("data-ink-theme")}})();`;
}
