# Ink Development Plan

## Current Assessment

Ink is already a broad TypeScript-first styling compiler for Vite apps. The repo includes static extraction, runtime fallback, builder styles, variants, themes, containers, Tailwind integration, Svelte/Astro/React support, and a substantial test suite.

The remaining work is less about adding feature breadth and more about making the system easier to understand, debug, trust, and adopt.

## Main Workstreams

1. Strengthen conceptual documentation.
2. Triage and implement source-map support.
3. Clarify static-analysis behavior and align tests/docs.
4. Decide whether declarative factory aliases belong in the public API.
5. Reduce Vite plugin maintenance risk through incremental seams.
6. Clarify publishing/package maturity and ecosystem positioning.

## Recommended Order

1. Documentation pass for mental model, syntax, debugging, and static limits.
2. Source-map spike and tests.
3. Static analyzer documentation/test alignment.
4. Optional factory alias decision.
5. Vite plugin refactor only as needed.
6. Publishing story decision.

## Success Criteria

- A new user can understand what happens at build time versus runtime without reading the implementation.
- Users can predict when styles are extracted statically and when runtime fallback is used.
- Debugging guidance exists for generated CSS, class names, virtual CSS, and resolution modes.
- Transformed modules no longer universally return `map: null` when code changes, or the source-map limitation is explicitly documented while implementation work is tracked.
- Public API changes are deliberate and tested, not added only because they are ergonomic in isolation.
- The Vite plugin becomes easier to maintain through small, tested extractions when implementation work touches complex areas.
- The package clearly communicates whether JSR-only publishing is intentional or npm publishing is supported.

## Verification

For code changes, run:

```bash
deno task test
deno task build
```

For documentation-only changes, run the full test suite once before merging if the branch also contains code or package metadata changes.
