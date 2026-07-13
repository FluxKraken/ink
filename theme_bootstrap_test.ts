import { assert, assertEquals } from "jsr:@std/assert";
import {
  generateThemeBootstrapScript,
  type ThemeBootstrapConfig,
} from "./src/theme-bootstrap.ts";

interface TestStorage {
  getItem(key: string): string | null;
}

type TestRoot = {
  theme: string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

function createRoot(initialTheme: string | null = null): TestRoot {
  return {
    theme: initialTheme,
    setAttribute(name, value) {
      if (name === "data-ink-theme") this.theme = value;
    },
    removeAttribute(name) {
      if (name === "data-ink-theme") this.theme = null;
    },
  };
}

function storageWith(values: Record<string, string>): TestStorage {
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key)
        ? values[key]
        : null;
    },
  };
}

function executeBootstrap(options: {
  config?: ThemeBootstrapConfig;
  themeNames?: readonly string[];
  localStorage?: TestStorage;
  sessionStorage?: TestStorage;
  initialTheme?: string | null;
} = {}): { root: TestRoot; script: string } {
  const config = options.config ?? { key: "themeMode" };
  const script = generateThemeBootstrapScript(
    config,
    options.themeNames ?? ["default", "dark"],
  );
  const root = createRoot(options.initialTheme);
  Function(
    "document",
    "localStorage",
    "sessionStorage",
    `"use strict";${script}`,
  )(
    { documentElement: root },
    options.localStorage ?? storageWith({}),
    options.sessionStorage ?? storageWith({}),
  );
  return { root, script };
}

Deno.test("theme bootstrap restores a valid JSON alternative", () => {
  const { root } = executeBootstrap({
    localStorage: storageWith({ themeMode: JSON.stringify("  dark  ") }),
  });

  assertEquals(root.theme, "dark");
});

Deno.test("theme bootstrap leaves root themes on the default CSS", () => {
  for (const selected of ["default", "root", ":root"]) {
    const { root } = executeBootstrap({
      themeNames: ["default", "root", ":root", "dark"],
      localStorage: storageWith({ themeMode: JSON.stringify(selected) }),
      initialTheme: "dark",
    });

    assertEquals(root.theme, null);
  }
});

Deno.test("theme bootstrap removes stale persisted themes", () => {
  const { root } = executeBootstrap({
    localStorage: storageWith({ themeMode: JSON.stringify("sepia") }),
    initialTheme: "dark",
  });

  assertEquals(root.theme, null);
});

Deno.test("theme bootstrap catches malformed JSON", () => {
  const { root } = executeBootstrap({
    localStorage: storageWith({ themeMode: "not-json" }),
    initialTheme: "dark",
  });

  assertEquals(root.theme, null);
});

Deno.test("theme bootstrap catches storage access errors", () => {
  const { root } = executeBootstrap({
    localStorage: {
      getItem() {
        throw new Error("storage unavailable");
      },
    },
    initialTheme: "dark",
  });

  assertEquals(root.theme, null);
});

Deno.test("theme bootstrap supports raw session storage", () => {
  const { root } = executeBootstrap({
    config: {
      key: "selected-theme",
      storage: "sessionStorage",
      deserialize: "raw",
    },
    localStorage: storageWith({ "selected-theme": "default" }),
    sessionStorage: storageWith({ "selected-theme": "  dark " }),
  });

  assertEquals(root.theme, "dark");
});

Deno.test("theme bootstrap safely embeds script-sensitive values", () => {
  const key = "theme</script>\u2028\u2029key";
  const theme = "night</script>\u2028\u2029mode";
  const { root, script } = executeBootstrap({
    config: { key },
    themeNames: ["default", theme],
    localStorage: storageWith({ [key]: JSON.stringify(theme) }),
  });

  assert(!script.toLowerCase().includes("</script"));
  assert(!script.includes("\u2028"));
  assert(!script.includes("\u2029"));
  assert(script.includes("\\u003c/script>"));
  assert(script.includes("\\u2028"));
  assert(script.includes("\\u2029"));
  assertEquals(root.theme, theme);
});
