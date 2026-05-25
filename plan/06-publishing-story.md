# Step 6: Publishing Story Decision

## Goal

Clarify whether Ink is intentionally JSR-first/JSR-only or whether npm publishing is an active support target.

## Concerns Addressed

- Package maturity.
- Ecosystem confidence.
- Install and export shape clarity.
- Difference between `package.json` and `deno.json` publishing metadata.

## Current State

- `package.json` has `"private": true`.
- `deno.json` owns the package name, version, exports, and JSR publish include list.
- README install instructions are JSR-oriented.
- The package ships TypeScript source plus generated `dist/**/*` in the JSR publish include list.

## Decision Options

1. JSR-first only: keep `package.json` private and document the publishing model clearly.
2. JSR-first with npm compatibility through JSR npm shims: document the shim path and support expectations.
3. Native npm package: remove `private`, define npm `exports`, define `files`, and create a tested npm publish workflow.

## Recommended Default

Make the current JSR-first story explicit before adding npm publishing complexity. Revisit native npm publishing if users need direct npm installation without JSR shims.

## Files To Update For JSR-First Clarity

- `README.md`
- `examples.md`
- Possibly `package.json` description fields if useful while remaining private.

## Files To Update For Native npm Support

- `package.json`
- `deno.json`
- `tsconfig.json`
- `README.md`
- Build/release scripts or CI configuration, if present later.

## Work Items

1. Decide target publishing model.
2. Document install paths and support expectations.
3. If JSR-first, explain why `package.json` is private.
4. If npm support is selected, design exports for `.`, `./vite`, `./react`, and `./cli`.
5. Add package verification steps before publishing, such as building and importing each public entrypoint.
6. Keep dependency policy clear: `csstype` dependency, `tailwind-merge` optional dependency, React peer dependency for `@kraken/ink/react`.

## Acceptance Criteria

- Users can tell how Ink is published and installed.
- Package metadata no longer looks accidental.
- npm support is either explicitly out of scope for now or backed by concrete metadata and verification.

## Verification

For docs-only JSR clarification, no code verification is required beyond normal review.

For npm metadata changes, run:

```bash
deno task build
deno task test
```
