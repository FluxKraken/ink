# Step 5: Vite Plugin Maintenance

## Goal

Reduce long-term maintenance risk in the large Vite plugin without doing a broad rewrite.

## Concerns Addressed

- Long-term maintenance cost of the Vite/parser layer.
- Complexity around Svelte, Astro, module extraction, aliases, config loading, virtual CSS, Tailwind runtime merge injection, CSS modules, and HMR.
- Risk of regressions from large unstructured changes.

## Files To Review

- `src/vite.ts`
- `src/parser.ts`
- `src/ast.ts`
- `vite_test.ts`

## Strategy

Only extract seams when a feature or fix already touches that area. Avoid a standalone rewrite unless the test suite and behavior are frozen first.

## Candidate Seams

1. Source-map helpers from step 2.
2. Virtual module ID and CSS cache helpers.
3. Import resolver helpers.
4. Config loading and normalization helpers.
5. Framework source-region extraction helpers for Svelte and Astro.
6. Static extraction result assembly helpers.

## Work Items

1. Identify the smallest helper extraction that supports current work.
2. Move only cohesive logic with narrow inputs and outputs.
3. Keep exported helper APIs private to `src/` unless they are intentionally public.
4. Add or preserve tests around the behavior being moved.
5. Avoid changing behavior and refactoring in the same commit if possible.
6. Keep `src/vite.ts` as the orchestration layer.

## Acceptance Criteria

- Any extraction is behavior-preserving.
- Tests pass after each seam is extracted.
- The plugin remains readable as orchestration rather than becoming a collection of hidden side effects.
- No public API changes are introduced by maintenance refactors.

## Verification

```bash
deno task test
deno task build
```
