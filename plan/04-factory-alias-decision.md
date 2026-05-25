# Step 4: Optional Factory Alias Decision

## Goal

Decide whether to add declarative aliases such as `ink.create(...)` and `ink.style(...)`, or explicitly keep the current builder and object shorthand APIs as the recommended public surface.

## Concerns Addressed

- API discoverability.
- TypeScript-native visual locality.
- Avoiding unnecessary API expansion.
- Static analyzer complexity.

## Current API

- Preferred builder API: `const styles = new ink(); styles.base = { ... }`.
- Simple mode: `new ink({ simple: true })`.
- Object shorthand: `ink({ ... })`.
- Tailwind class marker: `ink(...)` also accepts Tailwind-compatible input through the runtime call signature.

## Decision Options

1. Document-only decision: keep current APIs and explain when to use builder versus object shorthand.
2. Add `ink.create(config)` as an alias for the current object shorthand.
3. Add `ink.style(declaration)` as a single-style/simple-mode helper.
4. Defer both aliases until source maps and analyzer docs are complete.

## Recommended Default

Defer implementation until steps 1 through 3 are complete. If added later, prefer `ink.create(config)` first because it maps most directly to existing object shorthand behavior.

## Files To Update If Implemented

- `src/runtime.ts`
- `src/index.ts`
- `mod.d.ts`
- `src/parser.ts`
- `src/vite.ts`
- `vite_test.ts`
- `README.md`

## Evaluation Criteria

- Does the alias improve clarity enough to justify another public API shape?
- Can the Vite extractor support it without weakening failure modes?
- Are types as good as or better than the existing shorthand?
- Does it conflict with `ink(...)` currently being callable for Tailwind class input?
- Can docs present it without confusing new users about the recommended API?

## Acceptance Criteria For A No-Go Decision

- README clearly states the preferred API and when object shorthand is appropriate.
- No implementation changes are made.
- The decision can be revisited after source-map and analyzer documentation work.

## Acceptance Criteria For A Go Decision

- Runtime support exists.
- Static extractor support exists.
- Type declarations are updated.
- Tests cover runtime and extracted behavior.
- README examples are updated without de-emphasizing the builder API.

## Verification If Implemented

```bash
deno task test
deno task build
```
