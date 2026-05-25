# Step 3: Static Analyzer Documentation And Test Alignment

## Goal

Make static extraction behavior predictable by aligning docs, tests, and actual analyzer behavior.

## Concerns Addressed

- Static-analysis predictability.
- Documentation of failure modes.
- Confidence in `resolution: "static"` failures and hybrid fallback behavior.

## Files To Review

- `README.md`
- `examples.md`
- `vite_test.ts`
- `src/parser.ts`
- `src/ast.ts`
- `src/vite.ts`

## Work Items

1. Build a matrix of supported, fallback, and unsupported patterns.
2. Include examples for object literals, local `const`, imported `const`, module-level `new ink()` assignments, helper functions, spreads, conditionals, non-const bindings, and arbitrary calls.
3. Compare the matrix against existing tests in `vite_test.ts`.
4. Update README wording where it undersells or overstates analyzer behavior.
5. Add focused tests for any documented behavior that is important but currently untested.
6. Add static-mode failure examples so users know how to intentionally catch dynamic patterns.
7. Confirm Astro default static behavior is documented separately from non-Astro hybrid defaults.

## Suggested Matrix Columns

- Pattern.
- Example.
- Static extraction result.
- Hybrid behavior.
- Static mode behavior.
- Notes or caveats.

## Acceptance Criteria

- Docs accurately reflect current analyzer behavior.
- Important static and fallback behavior has test coverage.
- Users can predict whether a pattern extracts, falls back, or fails under static mode.
- Static-mode error messages remain useful and are not contradicted by docs.

## Verification

```bash
deno task test
deno task build
```
