# ADR-0002: Multi-account support via AccountStore + parameterized TokenStore

We introduced a new `AccountStore` service and made `TokenStore` nickname-aware to support multiple
Google Calendar identities within a single termeeting installation.

## Status

Accepted (2026-06-26)

## Context

The initial architecture hardcoded exactly one Google identity: `ConfigStore` stored one OAuth
client, `TokenStore` stored one token set in `google-token.json`. Users wanted to switch between
multiple Google accounts (e.g., work and personal) without re-running setup each time.

Options considered:

1. **Extend existing stores** — add account registry methods to `ConfigStore`, nickname parameter
   to `TokenStore`. Simpler dependency graph but blurs service boundaries.
2. **New `AccountStore`** — separate service for account registry operations, giving `TokenStore`
   a nickname parameter. Clearer separation but one more service to wire.
3. **Folders per account** — `accounts/<nickname>/token.json` and `accounts/<nickname>/config.json`.
   Would allow per-account OAuth credentials but added directory nesting with no current need for
   per-account credentials.

## Decision

We chose option 2 (new `AccountStore` + parameterized `TokenStore`) because:
- `TokenStore` is responsible for token I/O — adding account lifecycle logic to it would violate
  single responsibility.
- `ConfigStore` remains unchanged (shared credentials), avoiding unnecessary churn.
- A separate `AccountStore` makes the account lifecycle (`add`, `remove`, `set-default`) testable
  in isolation.
- We rejected per-account credentials (option 3) as over-engineering — no user has asked for
  different Google Cloud projects per identity.

Storage layout becomes:
```
~/.config/termeeting/
├── config.json           # shared OAuth client credentials (unchanged)
├── accounts.json         # { accounts: [...], default: "work" }
└── tokens/
    ├── work.json         # token set per account
    └── personal.json
```

`AuthService.authenticate()` was replaced by `runDeviceFlow(nickname)` which returns
`TokenAndEmail` — the email is resolved via `GET https://www.googleapis.com/calendar/v3/calendars/primary`
(reading the `id` field) after the device flow completes. This works with the existing
`calendar.readonly` scope, unlike the userinfo endpoint which requires additional email/profile scopes.

Existing `google-token.json` is auto-migrated on first run, prompting for a nickname.

## Consequences

- `TokenStore.read()` and `TokenStore.write()` now require a `nickname` string.
- `AuthService.getAccessToken()` and `CalendarApi.getEvents()` now require a `nickname` string.
- `CliService` resolves the nickname from `--account` flag or registry default and passes it
  through the call chain.
- `account add`, `account remove`, `account list`, `account set-default` become new CLI commands.
