import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type NotifierConfig = {
  discordBotToken: string;
  discordChannelId: string;
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
// location independent of install mechanism is required instead, matching
// the convention OpenCode itself uses for its own config (~/.config/opencode/).
const DEFAULT_CONFIG_DIR = join(homedir(), ".config", "opencode-discord-notifier");
const DEFAULT_CONFIG_PATH = join(DEFAULT_CONFIG_DIR, "config.json");

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

  const haveAllEnv = Boolean(fromEnv.discordBotToken && fromEnv.discordChannelId && fromEnv.allowedUserId);
  const path = configFilePath();
  const fileContents = haveAllEnv ? null : loadConfigFile(path);

  if (!haveAllEnv && fileContents === null) {
    throw new NotConfiguredError(
      `opencode-discord-notifier is not configured yet — create ${path} ` +
        `(see this package's config.example.json) or set the ` +
        "`DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID` and `DISCORD_ALLOWED_USER_ID` " +
        "environment variables. See the plugin's README for setup steps.",
    );
  }

  const source: RawConfigFile = haveAllEnv ? fromEnv : (fileContents ?? {});

  return {
    discordBotToken: asString(source.discordBotToken, "discordBotToken", path),
    discordChannelId: asString(source.discordChannelId, "discordChannelId", path),
    allowedUserId: asString(source.allowedUserId, "allowedUserId", path),
  };
}
