# Termeeting

CLI for Google Calendar (read-only). Returns events in human-readable or JSON format.

## Installation

```bash
npm i -g termeeting
```

## Setup

### 1. Create a Google Cloud project

Go to the [Google Cloud Console](https://console.cloud.google.com) and create a new project (or select an existing one).

### 2. Enable the Calendar API

Navigate to **APIs & Services > Library**, search for "Google Calendar API", and enable it.

### 3. Configure the OAuth consent screen

Go to **APIs & Services > OAuth consent screen**. Choose **External** and fill in the required fields (app name, support email, developer contact). No verification needed since it's for personal use — add your own email as a test user under **Audience > Test users**.

### 4. Create OAuth credentials

Go to **APIs & Services > Credentials > Create Credentials > OAuth client ID**.

- **Application type:** Desktop / TV and limited-input devices
- **Name:** Anything (e.g. "termeeting")

Once created, the dialog will show your **Client ID** and **Client Secret**. Copy them.

### 5. Add the redirect URI

On the credentials screen, click your newly created client, then add the following under **Authorized redirect URIs**:

```
http://localhost:3000/oauth/callback
```

Click **Save**.

### 6. Run setup

```bash
termeeting setup
```

Enter your Client ID and Client Secret when prompted. A browser opens for OAuth consent.
Your first account (nicknamed "default") is created automatically.

The app requests the `https://www.googleapis.com/auth/calendar.readonly` scope — read-only access to the primary calendar of each linked Google account.

## Accounts

Termeeting supports multiple Google Calendar identities.

```bash
termeeting account add work         # add another Google account
termeeting account add personal     # add another
termeeting account list             # show all accounts
termeeting account set-default work # set default for bare `termeeting` call
termeeting account remove personal  # remove an account
```

Each account stores its OAuth tokens separately. Use `--account` to select one:

```bash
termeeting --account work           # events from work calendar
termeeting --account personal --json  # personal events as JSON
```

If no `--account` is given, the default account is used.

## Usage

```bash
termeeting                              # today's events (default account)
termeeting --account work --json        # work events, JSON
termeeting --account personal --date 2026-06-30  # personal events for a date
termeeting next                         # next upcoming event (default account)
termeeting next --json                  # next event as JSON
termeeting setup                        # guided OAuth app registration + first account
termeeting account add <name>           # add another Google account
termeeting account list                 # list all accounts
termeeting account set-default <name>   # change default account
termeeting account remove <name>        # remove an account
```

Example output:

```
📅 Today — Wednesday, June 25, 2026
─────────────────────────────────────
09:00–10:00  Standup              (Room 3)
14:00–15:00  Design review        Google Meet
```

Account list example:

```
  work       alice@company.com  (default)
  personal   alice@gmail.com
```

Account list with `--json`:

```bash
termeeting account list --json
# [{"nickname":"work","email":"alice@company.com"},{"nickname":"personal","email":"alice@gmail.com"}]
```

## Development

```bash
npm test        # run tests
npm run build   # compile standalone binary
```

## License

ISC
