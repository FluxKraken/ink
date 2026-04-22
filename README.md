# ink

`ink` is a TypeScript-first styling library for Vite projects.

The preferred API is the builder pattern: create `new ink()`, assign `base`,
`variant`, `themes`, `global`, and `root` in small pieces, then use the
generated accessors in your components.

The Vite plugin extracts statically analyzable styles into a real stylesheet at
build time, while runtime fallback still works for dynamic cases.

`tw(...)` integrates cleanly with Tailwind classes and relies on
`tailwind-merge` to collapse conflicting utilities before the final class string
is returned.

## Install

```bash
deno add jsr:@kraken/ink
```

```bash
npx jsr add @kraken/ink
```

```bash
pnpm dlx jsr add @kraken/ink
```

If you want Tailwind-aware class composition, install `tailwind-merge` too:

```bash
npm install tailwind-merge
```

```bash
deno add npm:tailwind-merge
```

## Vite setup

```ts
// vite.config.ts
import { defineConfig } from "vite";
import inkVite from "@kraken/ink/vite";

export default defineConfig({
  plugins: [inkVite()],
});
```

By default the plugin transforms files inside `<project-root>/src/**` and
`<project-root>/app/**` (for frameworks like TanStack Start). You can extend
that with `include` in `ink.config.ts`.

Astro uses the same plugin through `astro.config.mjs`:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import inkVite from "@kraken/ink/vite";

export default defineConfig({
  vite: {
    plugins: [inkVite()],
  },
});
```

TanStack Start can register the same plugin in `app.config.ts`:

```ts
// app.config.ts
import { defineConfig } from "@tanstack/react-start/config";
import inkVite from "@kraken/ink/vite";

export default defineConfig({
  vite: {
    plugins: [inkVite()],
  },
});
```

Additional setup recipes live in [examples.md](./examples.md).

## Quick start

This is the recommended shape for new code: build styles incrementally with
`new ink()`.

```ts
import ink, { cVar, font } from "@kraken/ink";

const styles = new ink();

styles.root = [
  {
    "--surface": "#111827",
    "--text": "#f9fafb",
    "--radius": "1rem",
  },
];

styles.base = {
  card: {
    display: "grid",
    gap: "1rem",
    padding: "1rem",
    borderRadius: cVar("--radius"),
    backgroundColor: cVar("--surface"),
    color: cVar("--text"),
  },
  title: {
    fontFamily: font(["Inter", "system-ui", "sans-serif"]),
    fontSize: "1.25rem",
    fontWeight: 700,
  },
  body: {
    lineHeight: 1.5,
  },
};
```

```tsx
<article className={styles.card()}>
  <h2 className={styles.title()}>Builder first</h2>
  <p className={styles.body()}>
    Styles are authored in TypeScript and extracted to CSS by the Vite plugin.
  </p>
</article>;
```

## Accessing styles

Every style key becomes an accessor.

```ts
styles.card(); // class string
styles.card.class(); // same class string
styles.card.style(); // inline style string only

styles().card(); // equivalent factory access
```

Use factory access when a style key collides with a reserved builder property:

```ts
styles().base();
styles().global();
```

The reserved names are `base`, `global`, `themes`, `root`, `variant`, and
`defaults`.

For single-slot components, shorthand mode removes the extra style key:

```ts
const content = new ink({ simple: true });

content.base = {
  width: "min(100%, 64rem)",
  marginInline: "auto",
  padding: "1rem",
};

content.variant = {
  prose: {
    true: {
      lineHeight: 1.7,
    },
  },
};
```

```tsx
<main className={content({ prose: true })}>...</main>;
```

## Core features

### Variants and defaults

Variants are partial overrides grouped by a variant name. Defaults apply when no
explicit selection is passed.

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.base = {
  button: {
    padding: "0.75rem 1rem",
    borderRadius: "0.75rem",
    fontWeight: 600,
  },
  label: {},
};

styles.variant = {
  intent: {
    primary: {
      button: {
        backgroundColor: "#111827",
        color: "white",
      },
    },
    secondary: {
      button: {
        backgroundColor: "#e5e7eb",
        color: "#111827",
      },
    },
  },
  size: {
    sm: {
      button: { fontSize: "0.875rem" },
      label: { fontSize: "0.75rem" },
    },
    lg: {
      button: { fontSize: "1rem" },
      label: { fontSize: "0.875rem" },
    },
  },
};

styles.defaults = {
  intent: "primary",
  size: "sm",
};
```

```ts
styles.button(); // primary + sm
styles.button({ intent: "secondary" });
styles.label(); // gets the default size
styles.label.style({ size: "lg" }); // "font-size:0.875rem"
```

Variant blocks can also include quoted selectors such as `":global(html)"` when
you want variant-scoped global rules. See [examples.md](./examples.md) for a
full example.

### Fontsource fonts

Install the Fontsource package for the font you want to use:

```bash
npm install @fontsource/bungee
```

Then register it with Ink. The Vite plugin emits the package `@import` and the
root CSS variable for statically analyzable styles. Keep `fonts` static when you
use package imports so Vite can resolve the installed Fontsource package.

```ts
import ink, { font } from "@kraken/ink";

const styles = new ink();

styles.fonts = [
  { name: "Bungee", varName: "display" },
];

styles.base = {
  header: {
    fontFamily: font.display,
  },
};
```

`varName: "display"` creates `--font-display`, so `font.display` resolves to
`var(--font-display)`. By default Ink imports `@fontsource/<slug>` and appends
`system-ui` as the fallback family. Use `fallback` or `package` when a font
needs different behavior:

```ts
styles.fonts = [
  {
    name: "Inter Variable",
    varName: "body",
    package: "@fontsource-variable/inter",
    fallback: ["system-ui", "sans-serif"],
  },
];
```

### Themes and theme variables

`Theme` converts friendly token names into CSS custom properties. `tVar` reads
them back inside style objects.

```ts
import ink, { Theme, tVar } from "@kraken/ink";

const styles = new ink();

styles.themes = {
  default: new Theme({
    surface: "#ffffff",
    text: "#111827",
    accent: "#2563eb",
  }),
  dark: new Theme({
    surface: "#111827",
    text: "#f9fafb",
    accent: "#60a5fa",
  }),
};

styles.base = {
  panel: {
    backgroundColor: tVar.surface,
    color: tVar.text,
    border: [1, "solid", tVar.accent],
  },
  hero: {
    backgroundImage: tVar.eval("linear-gradient({surface}, {accent})"),
  },
};
```

Keys in `themes` behave like this:

- `default`, `root`, and `:root` go to `:root`
- bare names like `dark` become scoped selectors such as `.dark`
- explicit selectors like `".contrast"` are used as-is

With `themeMode: "color-scheme"` in `ink.config.ts`, only `default`/`root`/
`:root` and `dark` are used. `default` stays on `:root`, and `dark` is emitted
inside `@media (prefers-color-scheme: dark)`.

### React theme helper

If you want a small React wrapper for TanStack Start or other React apps, import
the provider from `@kraken/ink/react`.

```ts
import ink, { Theme } from "@kraken/ink";

export const styles = new ink();

styles.themes = {
  default: new Theme({
    surface: "#ffffff",
    text: "#111827",
  }),
  dark: new Theme({
    surface: "#111827",
    text: "#f9fafb",
  }),
  blue: new Theme({
    surface: "#eff6ff",
    text: "#1e3a8a",
  }),
};
```

```tsx
import { ThemeProvider, useTheme } from "@kraken/ink/react";
import { styles } from "./styles";

function ThemeToggle() {
  const { theme, setTheme, toggleTheme, themes } = useTheme();

  return (
    <div>
      <button onClick={toggleTheme}>Next theme ({theme})</button>
      <button onClick={() => setTheme("blue")}>Use blue</button>
      <span>{themes.join(", ")}</span>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider styles={styles} hotkey="mod+shift+t">
      <ThemeToggle />
    </ThemeProvider>
  );
}
```

`ThemeProvider` reads `styles.themes` in declaration order. With the example
above, `toggleTheme()` rotates through `default` -> `dark` -> `blue` ->
`default`. The provider manages `document.documentElement.classList`, so
root-like themes (`default`, `root`, `:root`) apply no class, while `dark`
applies `dark` and `.blue` applies `blue`.

This helper is intentionally limited to root/default themes and class-backed
theme keys. If you define a complex selector such as `[data-theme="dark"]`,
manage that selector yourself instead of using the helper.

`ThemeProvider` toggles classes on `document.documentElement`, so use
`themeMode: "scope"` when you want runtime theme switching.

### Tailwind classes via `tw(...)` and `tailwind-merge`

This is the most important integration point for mixed ink and Tailwind
projects.

`tw(...)` stores Tailwind classes, and `tailwind-merge` resolves conflicts
before the final class string is returned. That means:

- `px-3 px-4` becomes `px-4`
- `text-sm text-base` becomes `text-base`
- nested pseudo blocks like `hover` automatically prefix Tailwind variants

When you use the Vite plugin, ink also injects the Tailwind merge runtime for
transformed `tw(...)` modules so client-side variant selection works in the
browser as well as it does at build time.

```ts
import ink, { tw } from "@kraken/ink";

const styles = new ink();

styles.base = {
  button: {
    "@apply": tw(
      "inline-flex items-center px-3 px-4 py-2 rounded-md text-sm text-base",
    ),
    backgroundColor: "#111827",
    color: "white",
    hover: {
      "@apply": tw("underline underline-offset-2 underline-offset-4"),
    },
  },
  buttonLabel: tw("font-medium tracking-tight"),
};

styles.variant = {
  size: {
    lg: {
      button: tw("text-base text-lg"),
    },
  },
};
```

```ts
styles.button();
// returns merged Tailwind classes + a generated ink class name

styles.button.style();
// "background-color:#111827;color:white"

styles.buttonLabel();
// only Tailwind classes

styles.button({ size: "lg" });
// merged size override with tailwind-merge
```

Use `tw(...)` in two places:

- as a full style value: `buttonLabel: tw("font-medium")`
- as a top-level `@apply` entry inside a declaration

### Global CSS and imports

Use `global` for selectors and at-rules that should not generate local class
names.

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.global = {
  "@layer reset": {
    "html": { scrollBehavior: "smooth" },
    "body": { margin: 0 },
  },
  ".prose a": {
    textDecoration: "underline",
  },
};
```

Use `.import()` when you want to register external CSS files or global rule
objects incrementally:

```ts
styles.import("./src/reset.css");
styles.import({ path: "./src/theme.css", layer: "theme" });
styles.import({
  layer: "utilities",
  rules: {
    ".u-stack": {
      display: "grid",
      gap: "1rem",
    },
  },
});
```

### Root variables

Use `root` for explicit custom properties, optionally under a CSS layer.

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.root = [
  {
    "--space": "1rem",
    "--radius": "0.75rem",
  },
  {
    layer: "theme",
    vars: {
      "--accent": "#2563eb",
    },
  },
];
```

### Reusable declarations and `@apply`

`@apply` merges plain declarations, declaration arrays, named utilities from
`ink.config.ts`, and Tailwind markers.

```ts
import ink, { tw } from "@kraken/ink";

const surface = {
  backgroundColor: "#111827",
  color: "white",
};

const interactive = {
  transition: ["background-color 150ms ease", "color 150ms ease"],
  hover: { opacity: 0.9 },
};

const styles = new ink();

styles.base = {
  card: {
    "@apply": [surface, interactive, "cardBase"],
    padding: "1rem",
  },
  chip: {
    "@apply": tw("inline-flex items-center gap-2 rounded-full px-3 py-1"),
  },
};
```

### Breakpoints, containers, layers, and utilities in `ink.config.ts`

Put project-wide config in the repository root:

```ts
// ink.config.ts
import "./src/global.css";

export default {
  include: ["./packages/ui"],
  imports: ["./src/theme.css"],
  layers: ["reset", "theme", "components", "utilities"],
  defaultUnit: "rem",
  themeMode: "color-scheme",
  resolution: "hybrid",
  breakpoints: {
    sm: "40rem",
    md: "48rem",
    lg: "64rem",
  },
  containers: {
    card: {
      type: "inline-size",
      rule: "width < 30rem",
    },
  },
  utilities: {
    cardBase: {
      borderRadius: "1rem",
      boxShadow: "0 12px 40px rgb(0 0 0 / 0.12)",
    },
  },
};
```

`themeMode: "color-scheme"` uses `themes.default` as the light/root theme and
`themes.dark` inside `@media (prefers-color-scheme: dark)`. Use
`themeMode: "scope"` to keep the existing class/selector-based `@scope`
switching.

Then consume those aliases in your builder:

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.base = {
  card: {
    "@apply": ["cardBase"],
    "@set": "card",
    display: "grid",
    gap: 1,
    padding: 1,
    "@md": {
      gridTemplateColumns: ["1fr", "1fr"],
    },
    "@card": {
      gap: 0.75,
    },
  },
};
```

What each config field does:

- `layers` emits the CSS layer order prelude
- `defaultUnit` changes the unit appended to numeric values
- `breakpoints` powers `@md`, `!@md`, and `@(sm,lg)`
- `containers` powers `@set`, `@card`, and container ranges
- `utilities` creates global `.u-*` utility classes and named `@apply` targets
- `imports` and side-effect CSS imports become `@import` rules in the virtual
  stylesheet

### Runtime container registration

If a container preset only exists at runtime, register it on the builder:

```ts
const styles = new ink();

styles.addContainer({
  name: "card",
  type: "inline-size",
  rule: "width < 30rem",
});

styles.base = {
  shell: {
    "@set": "card",
  },
  section: {
    "@card": {
      padding: "0.75rem",
    },
  },
};
```

### Small conveniences

`ink` also supports a few common quality-of-life features:

- Arrays become space-delimited or comma-delimited CSS values depending on the
  property
- `font([...])` quotes font family names correctly
- `font.display` reads the CSS variable generated by `styles.fonts`
- Image-capable properties such as `backgroundImage` auto-wrap imported assets
  in `url(...)`

```ts
import ink, { font } from "@kraken/ink";
import heroImage from "./hero.png";

const styles = new ink();

styles.base = {
  hero: {
    backgroundImage: heroImage,
    backgroundSize: "cover",
    fontFamily: font(["IBM Plex Sans", "system-ui", "sans-serif"]),
    gridTemplateColumns: ["auto", "1fr"],
    transition: ["opacity 150ms ease", "transform 150ms ease"],
  },
};
```

## Object shorthand

`ink({ ... })` still exists for compact one-shot declarations:

```ts
import ink from "@kraken/ink";

const styles = ink({
  base: {
    card: {
      display: "grid",
      gap: "1rem",
    },
  },
});
```

Use it when a single object is genuinely clearer. The builder is still the
recommended API for anything non-trivial.

## How extraction works

- Static `ink({ ... })` calls and module-level `new ink()` assignments are
  extracted by the Vite plugin
- Extracted rules are emitted through `virtual:ink/styles.css`
- Dynamic cases still work at runtime by injecting styles in the browser
- `resolution: "static"` makes unresolved patterns fail the build instead of
  falling back to runtime
- `resolution: "hybrid"` is the default for non-Astro files
- Astro defaults to static resolution unless you override it

## Build-time limits

The parser handles the common, maintainable cases well:

- object literals
- local `const` style objects
- imported `const` style objects from relative files and configured aliases
- `new ink()` followed by module-level property assignments
- `@apply`, `tw(...)`, theme helpers, arrays, and nested selectors

It does not try to execute arbitrary runtime logic. Spreads, conditional object
construction, non-const bindings, and arbitrary function calls fall back to
runtime unless you force `resolution: "static"`.
