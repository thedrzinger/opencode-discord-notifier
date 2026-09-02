# opencode-discord-notifier

An OpenCode plugin that sends a Discord message when a running `opencode`
CLI session needs you — a permission request, a pending question, or the
session going idle after finishing work — and lets you answer a pending
permission request directly from Discord with **Once / Always / Reject**
buttons, without touching the keyboard.

Both notify-only and the interactive buttons are built and live-tested.

## What it notifies on

- **Permission requests** (`permission.asked`) — e.g. a bash command
  needing approval. Carries **Once / Always / Reject** buttons — click
  one to answer it from Discord.
- **Session idle** (`session.idle`) — the session finished and is waiting
  for you.
- **Pending questions** (OpenCode's built-in `question` tool) — notify
  only, permanently. There is no API to answer these from outside the
  OpenCode process (confirmed by live testing, not assumed), so this one
  always has to be answered from the keyboard.

## Prerequisites

A Discord bot application and token, invited to a server (or available
for DMs) with permission to send messages in the channel you want
notifications in. Setting one up is a standard Discord Developer Portal
flow — not covered here, plenty of existing guides for it. This plugin
only needs the `Guilds` intent; it doesn't read message content, so the
privileged Message Content intent is not required.

## Setup

1. Add the plugin to `opencode.json`:
   ```json
   { "plugin": ["opencode-discord-notifier"] }
   ```
   (Or an absolute local path instead of the package name, if you're
   developing against a local clone rather than the published package.)
2. Start `opencode` once so it fetches/loads the plugin.
3. Create the config file at:
   ```
   ~/.config/opencode/opencode-discord-notifier.json
   ```
   using `config.example.json` as the template:
   ```json
   {
     "discordBotToken": "your-bot-token",
     "discordChannelId": "123456789012345678",
     "allowedUserId": "123456789012345678"
   }
   ```
   **All three must be strings**, even though two of them look like
   numbers — Discord IDs are too large for JSON numbers to hold without
   losing precision.

   This lives directly in OpenCode's own config directory
   (`~/.config/opencode/`), named after this plugin so it's easy to tell
   apart from OpenCode's own config file and any other plugin's config
   sitting in the same directory. It's deliberately **not** inside
   wherever `opencode` installs/caches the plugin package itself (that
   location varies and isn't guaranteed to survive an update) — this is a
   fixed path independent of how the plugin got installed.

   Alternatives:
   - Set `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, and
     `DISCORD_ALLOWED_USER_ID` as environment variables instead of using a
     config file (checked first, before the file).
   - Point at a config file somewhere else with the
     `OPENCODE_DISCORD_NOTIFIER_CONFIG` environment variable.
4. Restart any running `opencode` process — plugins (and config) are only
   read at startup, so an edit while `opencode` is already running won't
   take effect until you restart it.
5. Confirm it worked by triggering a real permission prompt (e.g. asking
   the agent to run a shell command in a project where that needs
   approval) and checking that the Discord message arrives with buttons.

## Troubleshooting

If no Discord messages ever show up, check OpenCode's own log file
(`~/.local/share/opencode/log/opencode.log`) and grep it for
`opencode-discord-notifier` — a missing or malformed config, a bad bot
token, or a channel the bot can't see will show up there as a clear error
line, tagged with this plugin's name. A misconfigured install doesn't
crash or block the rest of OpenCode — it just logs the problem and
disables itself.

## Developing locally (not installing from npm)

`npm install && npm run build`, then reference this folder directly by
absolute path in `opencode.json`'s `plugin` array instead of a package
name — confirmed to correctly resolve this package's own `node_modules`
via normal Node module resolution, no bundling required.

