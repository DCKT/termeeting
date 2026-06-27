# AGENTS.md — Termeeting

CLI for Google Calendar (read-only). Returns events in human-readable or JSON format.

## Stack

- **Runtime:** Bun via `@effect/platform-bun`
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
│   ├── CliService.ts        # Command tree, handler functions, formatting
│   └── migration.ts         # legacy token migration
├── auth/
│   └── AuthService.ts       # OAuth device flow orchestration
├── calendar/
│   └── CalendarApi.ts       # Google Calendar HTTP client
└── storage/
    ├── TokenStore.ts        # read/write tokens from disk
    ├── ConfigStore.ts       # read/write config from disk
    └── AccountStore.ts      # multi-account registry (accounts.json)
test/
├── cli/
│   └── CliService.test.ts
├── auth/
│   └── AuthService.test.ts
├── calendar/
│   └── CalendarApi.test.ts
├── storage/
│   ├── TokenStore.test.ts
│   ├── ConfigStore.test.ts
│   └── AccountStore.test.ts
└── helpers/
    ├── AccountStore.ts
    ├── AuthService.ts
    ├── CalendarApi.ts
    ├── CliService.ts
    ├── ConfigStore.ts
    └── TokenStore.ts
```

## Architecture

4 services, each with `Tag` + live `Layer` + test `Layer`:

```typescript
// CalendarApi.ts — talks to Google Calendar REST API
class CalendarApi extends Context.Tag("CalendarApi")<CalendarApi, {
  getEvents(nickname: string, timeMin: string, timeMax: string, timeZone: string): Effect<GetEventsResult, CalendarError>
}>() {}

// TokenStore.ts — persists OAuth tokens to disk, parameterized by nickname
class TokenStore extends Context.Tag("TokenStore")<TokenStore, {
  read(nickname: string): Effect<Option<TokenSet>, TokenStoreError>
  write(nickname: string, tokens: TokenSet): Effect<void, TokenStoreError>
  deleteToken(nickname: string): Effect<void, TokenStoreError>
}>() {}

// AuthService.ts — orchestrates OAuth device flow, refreshes tokens
class AuthService extends Context.Tag("AuthService")<AuthService, {
  getAccessToken(nickname: string): Effect<string, AuthError>
  runDeviceFlow(nickname: string): Effect<TokenAndEmail, AuthError>
}>() {}

// CliService.ts — builds Command tree, exports handler functions
class CliService extends Context.Tag("CliService")<CliService, {
  command: Command.Command<any, any, any, any>
}>() {}
```

Dependency graph:

```
CliService → Command tree (built via @effect/cli)
  handlers → CalendarApi → AuthService → TokenStore
           → AccountStore
           → ConfigStore
           → Prompt (@effect/cli)
```

CalendarApi requires HttpClient. AuthService requires HttpClient + CommandExecutor (for openUrl). ConfigStore, TokenStore, AccountStore require FileSystem + Path + Config (HOME).

## OAuth flow

Device flow via Google OAuth:

1. User runs `termeeting setup` or `termeeting account add <nickname>`
2. App polls Google device code endpoint, obtains `user_code` + `verification_url`
3. Opens browser to verification URL
4. User enters code, grants calendar.readonly scope
5. App polls token endpoint, receives access + refresh tokens
6. Stores tokens in `~/.config/termeeting/tokens/<nickname>.json`
7. Resolves email via Calendar API primary calendar endpoint

## Storage

```
~/.config/termeeting/
├── config.json          # { "clientId": "...", "clientSecret": "..." }  (user-managed)
├── accounts.json        # { accounts: [...], default: "work" }
└── tokens/
    ├── work.json        # { accessToken, refreshToken, expiry }
    └── personal.json
```

## CLI interface

Uses `@effect/cli` `Command` / `Args` / `Options` for structured parsing:

```
termeeting                        # today's events, human-readable
termeeting --json                 # today's events, JSON
termeeting --date 2026-06-30     # events for specific date
termeeting --account work         # use specific account
termeeting next                   # next upcoming event today
termeeting next --json            # next event, JSON
termeeting setup                  # guided OAuth app registration
termeeting account add [nickname] # add new account
termeeting account list           # list accounts
termeeting account list --json    # list accounts, JSON
termeeting account remove <nickname>
termeeting account set-default <nickname>
```

Human-readable output format:

```
📅 Today — Wednesday, June 25, 2026
────────────────────────────────────
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
- Handler functions exported for isolated unit testing
- Captured console output via `Console.withConsole` for handler tests
- Concrete examples, no property-based testing required

## Commands

```bash
npm test              # run all tests
npm run typecheck     # tsc --noEmit
npm run lint          # tsc --noEmit
npm run build         # bun build --compile
```

## Conventions

- Every service file exports: `Tag`, the class/interface, `make` (live layer)
- Test layer factories (`makeTest`) live in `test/helpers/<ServiceName>.ts`, one per service
- Handler functions exported from CliService.ts for unit testing
- Errors are tagged types (`Data.TaggedError`), never raw strings
- No `any` or type casts in production code (except main.ts entrypoint)
- No global `Error` in Effect error channels
- Prefer `mapError` over `catchAll` for error transformation
- No `catchAllCause` — never hide defects
- No silently swallowed errors — every failure visible in `E`
- Files: PascalCase for service files, kebab-case for test files (matching src filename)
- No barrel files (no `index.ts` re-exports — import from specific modules)
- No default exports
- `Layer` composition uses `Layer.provide` / `Layer.merge`
- Entrypoint catches all errors and prints user-friendly messages

**Effect coding guidelines:** See [`docs/effect-guidelines.md`](docs/effect-guidelines.md).

## Agent skills

### Issue tracker

Issues tracked in GitHub Issues via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.
