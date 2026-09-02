import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type NotifierConfig = {
  discordBotToken: string;
  // Omitted entirely means DM mode: messages go to allowedUserId directly
  // instead of a server channel (see discord.ts's getChannel()).
  discordChannelId?: string;
  allowedUserId: string;
};

type RawConfigFile = Partial<{
  discordBotToken: unknown;
  discordChannelId: unknown;
  allowedUserId: unknown;
}>;

// Deliberately NOT resolved relative to this module's own install location.
// When installed as a real npm package (as opposed to a local path during
// development), OpenCode downloads/caches plugins into its own internal
// cache directory (observed: ~/.cache/opencode/packages/<name>) — not
// somewhere a user would think to look for a secrets file, and not
// guaranteed to survive a cache clear or version bump. A stable, documented
// location independent of install mechanism is required instead. Lives
// directly in OpenCode's own config directory (~/.config/opencode/),
// named after this plugin so it's unambiguous alongside OpenCode's own
// config file and any other plugin's config in the same directory.
const DEFAULT_CONFIG_PATH = join(homedir(), ".config", "opencode", "opencode-discord-notifier.json");

// Thrown only when nothing was ever configured (no env vars, no config
// file) — the expected state right after installing the plugin, not a
// real problem. Kept distinct from other config errors (bad JSON, a field
// missing from an actual config file) so the caller can treat "not set up
// yet" as informational rather than an alarming failure.
export class NotConfiguredError extends Error {}

// Discord snowflake IDs are 64-bit and exceed Number.MAX_SAFE_INTEGER, so a
// bare JSON number silently loses precision. Always read IDs as strings.
function asString(value: unknown, field: string, configPath: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number") {
    throw new Error(
      `opencode-discord-notifier: config field \`${field}\` must be a string, not a number ` +
        `(Discord IDs are too large for JSON numbers to hold precisely — quote it: "${field}": "${value}")`,
    );
  }
  throw new Error(
    `opencode-discord-notifier: config field \`${field}\` is missing or invalid in ${configPath}\n` +
      `Expected: {"discordBotToken": "...", "discordChannelId": "...", "allowedUserId": "..."}`,
  );
}

// discordChannelId is the one optional field: leaving it unset means DM
// mode (see NotifierConfig). An empty string is treated the same as unset
// rather than an error, so someone clearing the value out of a config
// file doesn't need to delete the whole line.
function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value.length > 0 ? value : undefined;
  if (typeof value === "number") {
    throw new Error(
      `opencode-discord-notifier: config field \`${field}\` must be a string, not a number ` +
        `(Discord IDs are too large for JSON numbers to hold precisely — quote it: "${field}": "${value}")`,
    );
  }
  throw new Error(`opencode-discord-notifier: config field \`${field}\` must be a string if present`);
}

function configFilePath(): string {
  return process.env.OPENCODE_DISCORD_NOTIFIER_CONFIG || DEFAULT_CONFIG_PATH;
}

function loadConfigFile(path: string): RawConfigFile | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as RawConfigFile;
}

export function loadConfig(): NotifierConfig {
  const fromEnv = {
    discordBotToken: process.env.DISCORD_BOT_TOKEN,
    discordChannelId: process.env.DISCORD_CHANNEL_ID,
    allowedUserId: process.env.DISCORD_ALLOWED_USER_ID,
  };

  // discordChannelId is deliberately excluded here: it's optional (DM
  // mode), so its presence/absence shouldn't decide whether env vars vs.
  // the config file gets used — only the two always-required fields do.
  const haveRequiredEnv = Boolean(fromEnv.discordBotToken && fromEnv.allowedUserId);
  const path = configFilePath();
  const fileContents = haveRequiredEnv ? null : loadConfigFile(path);

  if (!haveRequiredEnv && fileContents === null) {
    throw new NotConfiguredError(
      `opencode-discord-notifier is not configured yet — create ${path} ` +
        `(see this package's config.example.json) or set the ` +
        "`DISCORD_BOT_TOKEN` and `DISCORD_ALLOWED_USER_ID` " +
        "environment variables. See the plugin's README for setup steps.",
    );
  }

  const source: RawConfigFile = haveRequiredEnv ? fromEnv : (fileContents ?? {});

  return {
    discordBotToken: asString(source.discordBotToken, "discordBotToken", path),
    discordChannelId: asOptionalString(source.discordChannelId, "discordChannelId"),
    allowedUserId: asString(source.allowedUserId, "allowedUserId", path),
  };
}
