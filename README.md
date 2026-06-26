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

Enter your Client ID and Client Secret when prompted. A browser opens for OAuth consent, and tokens are stored automatically at `~/.config/termeeting/config.json`.

The app requests the `https://www.googleapis.com/auth/calendar.readonly` scope — read-only access to your primary calendar.

## Usage

```bash
termeeting                  # today's events, human-readable table
termeeting next             # next upcoming event today
termeeting next --json      # next upcoming event, JSON
termeeting --json           # today's events, JSON
termeeting --date 2026-06-30  # events for a specific date
termeeting setup            # guided OAuth app registration
```

Example output:

```
📅 Today — Wednesday, June 25, 2026
─────────────────────────────────────
09:00–10:00  Standup              (Room 3)
14:00–15:00  Design review        Google Meet
```

## Development

```bash
npm test        # run tests
npm run build   # compile standalone binary
```

## License

ISC
