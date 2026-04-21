# ink recipes

This file complements the main [README](./README.md).

The README is builder-first and covers the core API. These recipes focus on the
setup and patterns that are useful once the basics are already in place.

## `ink.config.ts` starter

Use a root config file when you want project-wide imports, layers, breakpoints,
containers, and utilities.

```ts
// ink.config.ts
import "./src/global.css";

export default {
  imports: ["./src/theme.css"],
  include: ["./packages/ui"],
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
      padding: "1rem",
      boxShadow: "0 12px 40px rgb(0 0 0 / 0.12)",
    },
    mutedText: {
      color: "#6b7280",
      fontSize: "0.875rem",
    },
  },
};
```

## Breakpoints, containers, and utilities together

This is the smallest example that shows how the config aliases are consumed by
the builder API.

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.base = {
  card: {
    "@apply": ["cardBase"],
    "@set": "card",
    display: "grid",
    gap: 1,
    "@md": {
      gridTemplateColumns: ["1fr", "1fr"],
    },
    "@card": {
      gap: 0.75,
    },
  },
  note: {
    "@apply": ["mutedText"],
  },
};
```

What this does:

- `@apply: ["cardBase"]` reuses the utility declared in `ink.config.ts`
- `@set: "card"` assigns `container-name` and `container-type`
- `@md` expands to a media query
- `@card` expands to a container query
- numeric values use `rem` because `defaultUnit` is set to `"rem"`

## Variant-scoped global theme switching

Quoted selectors inside `variant` are applied only when that variant is active.
This is a clean way to switch `html` or `body` globals together with local
component styles.

```ts
import ink from "@kraken/ink";

const styles = new ink();

styles.base = {
  appShell: {
    minHeight: "100dvh",
  },
};

styles.variant = {
  theme: {
    light: {
      appShell: {
        backgroundColor: "#ffffff",
        color: "#111827",
      },
      ":global(html)": {
        colorScheme: "light",
      },
    },
    dark: {
      appShell: {
        backgroundColor: "#111827",
        color: "#f9fafb",
      },
      ":global(html)": {
        colorScheme: "dark",
      },
    },
  },
};

styles.defaults = {
  theme: "dark",
};
```

```ts
styles.appShell(); // dark by default
styles.appShell({ theme: "light" });
```

## Imported images and multi-value properties

Imported image assets can be assigned directly to image-capable CSS properties.
Array values become either space-delimited or comma-delimited CSS depending on
the property.

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
    boxShadow: [
      "0 8px 20px rgb(0 0 0 / 0.16)",
      "inset 0 1px 0 rgb(255 255 255 / 0.08)",
    ],
  },
};
```

## Astro setup

Astro does not usually have its own `vite.config.ts`, so register the plugin
through Astro's `vite` option.

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

## TanStack Start setup

TanStack Start routes commonly live under `app/**`, which is included by
default. Register the plugin in `app.config.ts`.

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

## Deno + Vite without `package.json`

When you install from JSR and do not have a `package.json`, Vite still needs a
Node-compatible import target. Map the package to its npm shim and add a Vite
alias.

```json
// deno.json
{
  "imports": {
    "@kraken/ink": "npm:@jsr/kraken__ink"
  }
}
```

```ts
// vite.config.ts
import { defineConfig } from "vite";
import inkVite from "@kraken/ink/vite";

export default defineConfig({
  resolve: {
    alias: {
      "@kraken/ink": "@jsr/kraken__ink",
    },
  },
  plugins: [inkVite()],
});
```

## Svelte usage

The runtime API is the same in Svelte. The only difference is how you pass the
class string into markup.

```svelte
<script lang="ts">
  import ink from "@kraken/ink";

  const styles = new ink();

  styles.base = {
    card: {
      display: "grid",
      gap: "1rem",
      padding: "1rem",
    },
    title: {
      fontSize: "1.25rem",
      fontWeight: 700,
    },
  };
</script>

<article class={styles.card()}>
  <h2 class={styles.title()}>Hello</h2>
</article>
```
