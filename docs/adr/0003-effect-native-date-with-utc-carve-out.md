# ADR-0003: Effect-native date enforcement with `Date.UTC()` carve-out

## Status

Accepted (2026-06-26)

## Context

`@effect/language-service`'s `globalDate` and `globalDateInEffect` diagnostics flag `new Date()` and `Date.now()` as Effect idioms expect `DateTime` and `Clock` instead. We originally set these to `"warning"`, which produced visible diagnostics but allowed builds to pass — creating drift between lint intent and actual enforcement.

`Date.UTC(year, month, day)` at `src/cli/CliService.ts:162` is also a global `Date` call but is entirely deterministic: given the same three integers, it always returns the same epoch milliseconds. It has no clock dependency, no side effects, and no Effect equivalent that would improve the code. Unlike `Date.now()` (which depends on system clock and should go through Effect's `Clock` to stay testable), `Date.UTC()` is pure arithmetic.

Seven `makeTest` layer factories live in `src/` and are compiled by `tsc`. Their test-only nature causes them to trigger `globalDate`/`globalDateInEffect` violations that have nothing to do with production correctness.

## Decision

1. **`globalDate` and `globalDateInEffect` set to `"error"`** in `tsconfig.json`. Builds fail on any raw `new Date()` or `Date.now()`.

2. **`Date.UTC()` deliberately accepted** as a pure, deterministic computation. It is not clock-dependent and has no meaningful Effect equivalent. The ADR (this document) is the single source of truth for why it's allowed — no inline comment needed.

3. **`makeTest` factories moved from `src/` to `test/helpers/<ServiceName>.ts`**, one file per service, mirroring the `src/` structure. This keeps production-only code in `src/` (avoiding false-positive date violations on test data), and `test/` stays excluded from `tsc` compilation. Convention update: service files export `Tag`, the class, and `make` (live layer) only. Test layers import from `test/helpers/`.

## Consequences

- Any new `new Date()` or `Date.now()` in production code is a compile error, preventing recidivism
- `Date.UTC()` at `CliService.ts:162` remains untouched; future similar uses must be argued case-by-case (the ADR does not grant blanket permission for all `Date.*` static methods — only `Date.UTC` is explicitly accepted here)
- Test files change their imports from `../../src/<service>.js` to `../../helpers/<ServiceName>.js` for `makeTest`
- `AGENTS.md` service-file convention loses the `makeTest` export requirement
