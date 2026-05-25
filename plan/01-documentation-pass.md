# Step 1: Documentation Pass

## Goal

Make Ink's mental model, syntax conventions, debugging workflow, and extraction boundaries obvious before users need to inspect source code or tests.

## Concerns Addressed

- API discoverability.
- Static/dynamic mental model.
- Breakpoint and container shorthand clarity.
- Array joining rules.
- Theme registration flow.
- Debugging confidence.
- Ecosystem confidence compared with SASS, Tailwind, CSS Modules, and vanilla-extract.

## Files To Update

- `README.md`
- `examples.md`
- Optional future docs folder if README becomes too large.

## Work Items

1. Add a “Mental model” section near the top of `README.md`.
2. Explain build-time extraction, virtual CSS emission, and browser runtime fallback.
3. Explain `resolution: "static"`, `resolution: "hybrid"`, and `resolution: "dynamic"` in plain language.
4. Expand breakpoint docs for `@lg`, `!@lg`, and `@(sm,lg)`.
5. Expand container docs for `@set`, named container aliases, and container ranges.
6. Add an array serialization section with examples for space-separated and comma-separated output.
7. Add theme flow docs showing where tokens are declared, registered, referenced with `tVar`, and emitted as CSS variables.
8. Add debugging docs for `virtual:ink/styles.css`, `debug.logStatic`, `debug.logDynamic`, and class-name stability.
9. Add a recommended project structure recipe.
10. Add short comparison/migration notes for SASS, Tailwind, CSS Modules, and vanilla-extract.

## Suggested README Sections

- `## Mental model`
- `## Resolution modes`
- `## Syntax conventions`
- `## Debugging Ink output`
- `## Recommended project structure`
- `## Comparisons and migration notes`

## Acceptance Criteria

- A reader can explain what Ink does at build time and runtime after reading the README.
- `!@lg` and `@(sm,lg)` are documented with concrete output-level meaning.
- Array joining rules are documented with examples.
- Static extraction limits are visible before the end of the README or linked from the top.
- Existing API reference remains accurate and not contradicted by new conceptual docs.

## Verification

- Review docs against current tests in `vite_test.ts` to avoid documenting unsupported behavior.
- Run `deno task test` if any code examples are copied into tests or code changes are made.
