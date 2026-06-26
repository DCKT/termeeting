# AGENTS.md — Termeeting

CLI for Google Calendar (read-only). Returns events in human-readable or JSON format.

## Stack

- **Runtime:** Node.js via tsx
- **Language:** TypeScript (strict)
- **Core:** Effect-TS (`effect`, `@effect/cli`, `@effect/platform`)
- **Testing:** vitest + `@effect/vitest`
- **Package manager:** npm
- **Distribution:** `npm i -g termeeting`

## Project structure

```
src/
├── main.ts                  # entrypoint
├── cli/
│   └── CliService.ts        # arg parsing, output formatting, wiring
├── auth/
│   └── AuthService.ts       # OAuth loopback orchestration
├── calendar/
│   └── CalendarApi.ts       # Google Calendar HTTP client
└── storage/
    ├── TokenStore.ts        # read/write tokens from disk
    └── ConfigStore.ts       # read/write config from disk
test/
├── cli/
│   └── CliService.test.ts
├── auth/
│   └── AuthService.test.ts
├── calendar/
│   └── CalendarApi.test.ts
└── storage/
    ├── TokenStore.test.ts
    └── ConfigStore.test.ts
```

## Architecture

4 services, each with `Tag` + live `Layer` + test `Layer`:

```typescript
// CalendarApi.ts — talks to Google Calendar REST API
class CalendarApi extends Context.Tag("CalendarApi")<CalendarApi, {
  getEvents(timeMin: string, timeMax: string, timeZone: string): Effect<readonly Event[], CalendarError>
}>() {}

// TokenStore.ts — persists OAuth tokens to disk
class TokenStore extends Context.Tag("TokenStore")<TokenStore, {
  read(): Effect<Option<TokenSet>, TokenStoreError>
  write(tokens: TokenSet): Effect<void, TokenStoreError>
}>() {}

// AuthService.ts — orchestrates OAuth flow, refreshes tokens
class AuthService extends Context.Tag("AuthService")<AuthService, {
  getAccessToken(): Effect<string, AuthError>
}>() {}

// CliService.ts — parses args, formats output, calls CalendarApi
class CliService extends Context.Tag("CliService")<CliService, {
  run(args: readonly string[]): Effect<string, CliError>
}>() {}
```

Dependency graph:

```
CliService → CalendarApi → AuthService → TokenStore
           ↘ ConfigStore
```

CalendarApi requires HttpClient (for API calls). AuthService requires HttpClient (for OAuth token exchange).

## OAuth flow

Loopback redirect on `http://localhost:3000/oauth/callback`:

1. Start temporary HTTP server on port 3000
2. Open browser to Google consent URL
3. Google redirects to localhost with auth code
4. Exchange code for token set (access + refresh)
5. Store tokens in `~/.config/termeeting/google-token.json`
6. On subsequent runs: load tokens, refresh if expired

## Storage

```
~/.config/termeeting/
├── config.json          # { "clientId": "...", "clientSecret": "..." }  (user-managed)
└── google-token.json    # { "accessToken": "...", "refreshToken": "...", "expiry": "..." }  (program-managed)
```

## CLI interface

```
termeeting                        # today's events, human-readable table
termeeting --json                 # today's events, JSON
termeeting --date 2026-06-30     # events for specific date
termeeting setup                  # guided OAuth app registration
```

Human-readable output format:

```
📅 Today — Wednesday, June 25, 2026
─────────────────────────────────────
09:00–10:00  Standup              (Room 3)
14:00–15:00  Design review        Google Meet
```

## Calendar scope

- Primary calendar only
- Read-only (`https://www.googleapis.com/auth/calendar.readonly`)
- User's local timezone (auto-detected via `Intl.DateTimeFormat`)

## Testing

- Framework: vitest + `@effect/vitest`
- Each service gets unit tests with mock layers (`Layer.succeed(tag, mock)`)
- Integration tests wire real layers: TokenStore with temp dir, CalendarApi with mock HTTP
- Concrete examples, no property-based testing required

## Commands

```bash
npm test              # run all tests
npm run typecheck     # tsc --noEmit
npm run lint          # eslint / biome
npm run build         # compile (if bundling)
```

## Conventions

- Every service file exports: `Tag`, the class/interface, `make` (live layer)
- Test layer factories (`makeTest`) live in `test/helpers/<ServiceName>.ts`, one per service
- Errors are tagged types (`Data.TaggedError`), never raw strings
- No `any` or type casts in production code
- No global `Error` in Effect error channels
- Prefer `mapError` over `catchAll` for error transformation
- No `catchAllCause` — never hide defects
- No silently swallowed errors — every failure visible in `E`
- Files: PascalCase for service files, kebab-case for test files (matching src filename)
- No barrel files (no `index.ts` re-exports — import from specific modules)
- No default exports
- `Layer` composition uses `Layer.provide` / `Layer.merge`
- Entrypoint catches all errors and prints user-friendly messages

**Effect coding guidelines:** See [`docs/effect-guidelines.md`](docs/effect-guidelines.md) — adapted from [mikearnaldi/accountability](https://github.com/mikearnaldi/accountability).

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at repo root (not yet created). See `docs/agents/domain.md`.
