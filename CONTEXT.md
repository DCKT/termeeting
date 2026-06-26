# Termeeting

CLI for fetching read-only calendar events from one or more Google Calendar identities.

## Language

### Identities

**Account**:
A named Google Calendar identity consisting of OAuth tokens and a resolved email address.
_Avoid_: Profile, identity, user

**Nickname**:
A user-chosen, case-sensitive label for an Account. Must match `/^[a-zA-Z0-9_-]+$/`.
Used as the filename in `tokens/<nickname>.json` and as the key in the registry.
_Avoid_: Name, alias, handle

**Default Account**:
The Account used when no `--account` flag is given. Tracked in `accounts.json`. The first account added is auto-set as default.

**Registry** (`accounts.json`):
On-disk index of all Accounts and the default. Format: `{ accounts: [{ nickname, email }], default: "work" }`.
_Avoid_: Account list, profile index

### Authorization

**Credentials** (`config.json`):
Shared Google OAuth Client ID and Secret used to authenticate any Account.
_Avoid_: Client config, app config

**Token Set**:
Per-Account OAuth tokens (access token, refresh token, expiry) stored in `tokens/<nickname>.json`.
_Avoid_: Session, auth state

## Relationships

- **Credentials** are shared across all **Accounts**
- Each **Account** has exactly one **Token Set**
- Each **Account** has exactly one **Nickname**
- A **Registry** points to zero or more **Accounts** and optionally one **Default Account**

## Example dialogue

> **Dev:** "When the user runs `termeeting --account work`, do we also need to re-read the credentials from disk?"
> **Domain expert:** "Credentials are cached in the service layer for the duration of the effect, but re-read from `config.json` on each invocation of the CLI."
>
> **Dev:** "What happens if the default Account's token is expired?"
> **Domain expert:** "The refresh flow runs automatically via `AuthService.getAccessToken(nickname)`. The new token set is written back to the same `tokens/<nickname>.json` file. The default designation doesn't change."

## Flagged ambiguities

- "account" was previously used to mean "the single Google identity" — resolved: now means one named Google identity among potentially several.
- "token file" was previously the single `google-token.json` — resolved: now `tokens/<nickname>.json` per Account.
