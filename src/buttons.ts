import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

// customId shape: "dnotify:v1:<sessionId>:<permissionId>:<action>"
// Session/permission IDs observed in testing are alphanumeric + underscore
// (e.g. "ses_...", "per_..."), never containing a colon, so a plain split
// is safe. Well within Discord's 100-char customId limit.
const PREFIX = "dnotify:v1";

export type PermissionAction = "once" | "always" | "reject";

export type ParsedPermissionCustomId = {
  sessionId: string;
  permissionId: string;
  action: PermissionAction;
};

function buildCustomId(sessionId: string, permissionId: string, action: PermissionAction): string {
  return [PREFIX, sessionId, permissionId, action].join(":");
}

export function parsePermissionCustomId(customId: string): ParsedPermissionCustomId | null {
  if (!customId.startsWith(`${PREFIX}:`)) return null;
  const parts = customId.split(":");
  if (parts.length !== 5) return null;
  const [, , sessionId, permissionId, action] = parts;
  if (action !== "once" && action !== "always" && action !== "reject") return null;
  if (!sessionId || !permissionId) return null;
  return { sessionId, permissionId, action };
}

export function buildPermissionButtons(sessionId: string, permissionId: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildCustomId(sessionId, permissionId, "once"))
      .setLabel("Once")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(buildCustomId(sessionId, permissionId, "always"))
      .setLabel("Always")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildCustomId(sessionId, permissionId, "reject"))
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger),
  );
}
