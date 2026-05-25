# Step 2: Source-Map Spike And Tests

## Goal

Replace the current `map: null` transform results with useful Vite-compatible source maps where Ink changes module code.

## Concerns Addressed

- Debuggability.
- Source maps from generated/transformed output back to source files.
- Confidence in transformed Svelte, Astro, TS, TSX, JS, and JSX modules.

## Current Evidence

`src/vite.ts` currently returns `map: null` in transform paths that mutate code:

- Around `src/vite.ts:3619` when a Svelte/Astro file needs only a virtual stylesheet import.
- Around `src/vite.ts:4526` after extraction and replacement work.

## Files To Update

- `src/vite.ts`
- Potential helper file such as `src/source_map.ts`
- `vite_test.ts`
- `README.md` debugging section from step 1, if source-map scope needs to be documented.

## Work Items

1. Inventory every transform path that changes code and currently returns `map: null`.
2. Decide the first source-map scope: identity maps plus adjusted mappings for inserted imports, or full replacement-aware maps.
3. Add a small source-map helper rather than embedding all mapping logic in `src/vite.ts`.
4. Generate maps for unchanged source regions and virtual import insertions.
5. Preserve correct file names and source content where practical.
6. Add targeted tests that transformed output includes a non-null source map when code is changed.
7. Add tests for at least one plain TS/JS transform and one framework-shaped transform if feasible.
8. Document any remaining limitation, especially if generated CSS declaration-level source maps are not implemented yet.

## Implementation Notes

- Prefer a minimal helper and avoid a broad `src/vite.ts` rewrite.
- Source maps should be Vite-compatible return objects.
- If full precision is too large for the first pass, start with a conservative map that is more useful than `null` and clearly document the limitation.

## Acceptance Criteria

- Transforms that mutate module code return a non-null source map.
- Existing tests continue passing.
- New tests assert map presence and basic shape.
- Limitations are documented if mappings are not yet declaration-precise.

## Verification

```bash
deno task test
deno task build
```
