import { MessageFlags } from "discord.js";
import type { Plugin } from "@opencode-ai/plugin";
import { buildPermissionButtons, parsePermissionCustomId } from "./buttons.js";
import { loadConfig, NotConfiguredError, type NotifierConfig } from "./config.js";
import { createDiscordNotifier, type Notifier } from "./discord.js";
import {
  appendPermissionOutcome,
  formatPermissionAsked,
  formatQuestionPending,
  formatSessionIdle,
  projectLabel,
} from "./format.js";

const SERVICE = "opencode-discord-notifier";

// client.tui.* calls (e.g. showToast) block indefinitely with no real TUI
// attached — confirmed live for both showToast and tui.control.next(). A
// plain .catch() does NOT protect against this, since the promise never
// rejects, it just never resolves. Any client.tui.* call from this plugin
// MUST be raced against a hard timeout, or a headless/API-driven session
// (or a TUI that hasn't finished attaching yet) can hang plugin
// initialization forever.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms))]);
}

function findQuestionPart(properties: any): any | null {
  const candidates: any[] = [];
  if (properties?.part) candidates.push(properties.part);
  if (Array.isArray(properties?.info?.parts)) candidates.push(...properties.info.parts);
  for (const part of candidates) {
    if (part?.type === "tool" && part?.tool === "question") return part;
  }
  return null;
}

export const DiscordNotifierPlugin: Plugin = async ({ project, directory, worktree, client }) => {
  // Plain console.error/console.log from inside a plugin never reaches
  // anywhere a user would see it — confirmed live: even an unconditional
  // console.error at the very top of this function, with a valid config,
  // produced zero output in the host process's captured stdout/stderr.
  // client.app.log() is the real, working alternative: it writes into
  // OpenCode's own persistent log (~/.local/share/opencode/log/opencode.log),
  // confirmed live, tagged with `service` so it's greppable.
  async function logError(message: string) {
    console.error(`[${SERVICE}] ${message}`);
    await client.app.log({ body: { service: SERVICE, level: "error", message } }).catch(() => {});
  }

  let config: NotifierConfig;
  let notifier: Notifier;
  try {
    config = loadConfig();
    notifier = await createDiscordNotifier(config);
  } catch (err) {
    if (err instanceof NotConfiguredError) {
      // Expected right after installing the plugin, before the user has
      // set up a config file or env vars — not a failure, so no error-level
      // log and no toast (which would otherwise pop an alarming "failed to
      // start" message on every single startup of an intentionally-not-yet
      // -configured plugin).
      await client.app.log({ body: { service: SERVICE, level: "info", message: err.message } }).catch(() => {});
      return {};
    }

    const message = `failed to start: ${err instanceof Error ? err.message : String(err)}`;
    await logError(message);
    // Also try a TUI toast for the realistic case (a real interactive
    // session watching the terminal) — best-effort. MUST be time-boxed:
    // this call hangs forever with no TUI attached (confirmed live), so
    // a bare .catch() alone would leave plugin init hung indefinitely.
    await withTimeout(
      client.tui.showToast({ body: { title: "Discord notifier failed to start", message, variant: "error" } }).catch(() => {}),
      2000,
    );
    // Degrade gracefully: return a no-op plugin rather than throwing,
    // so the rest of OpenCode is unaffected by a misconfigured notifier.
    return {};
  }

  const label = projectLabel(directory, worktree ?? project?.worktree);
  const notifiedQuestionIds = new Set<string>();
  // Permission IDs this specific plugin instance actually sent a
  // notification for. Discord broadcasts every button click to every
  // connected session on this bot token (confirmed live), so this set is
  // what lets each concurrent `opencode` session only act
  // on its own pending permissions. Entries are kept for the process's
  // lifetime (not deleted after one click) so a second/duplicate click on
  // an already-answered permission still routes through the real API call
  // and gets a clean "already answered" response, rather than being
  // silently dropped as "not mine."
  const ownedPermissions = new Set<string>();

  async function safeSend(content: string, components?: Parameters<typeof notifier.send>[1]) {
    try {
      await notifier.send(content, components);
    } catch (err) {
      await logError(`failed to send Discord message: ${String(err)}`);
    }
  }

  notifier.onButtonClick(async (interaction) => {
    const parsed = parsePermissionCustomId(interaction.customId);
    if (!parsed) return; // not one of our buttons

    if (!ownedPermissions.has(parsed.permissionId)) {
      // Not this instance's pending permission. Either a different
      // concurrent `opencode` session owns it, or the message is stale.
      // Deliberately do nothing — no ack, no reply — so the owning
      // instance (if any) is the only one that responds.
      return;
    }

    if (String(interaction.user.id) !== config.allowedUserId) {
      await interaction
        .reply({ content: "You're not authorized to respond to this.", flags: MessageFlags.Ephemeral })
        .catch((err) => logError(`failed to send unauthorized notice: ${String(err)}`));
      return;
    }

    // Ack Discord immediately — never wait on the OpenCode round-trip
    // first, or a slow reply produces a hard "did not respond" error
    // even though the click was received (confirmed live).
    await interaction.deferUpdate();

    const originalContent = interaction.message.content;
    let newContent: string;
    try {
      const result = await client.postSessionIdPermissionsPermissionId({
        path: { id: parsed.sessionId, permissionID: parsed.permissionId },
        body: { response: parsed.action },
      });
      // The SDK returns {data, error} and does NOT throw on failure —
      // confirmed live. Checking result.error explicitly is required;
      // try/catch alone would miss this.
      if (result.error) {
        const tag = (result.error as any)?._tag;
        if (tag === "PermissionNotFoundError") {
          newContent = appendPermissionOutcome(originalContent, { kind: "already-answered" });
        } else {
          const message = (result.error as any)?.message ?? JSON.stringify(result.error);
          newContent = appendPermissionOutcome(originalContent, { kind: "error", message });
        }
      } else {
        newContent = appendPermissionOutcome(originalContent, { kind: "success", action: parsed.action });
      }
    } catch (err) {
      newContent = appendPermissionOutcome(originalContent, { kind: "error", message: String(err) });
    }

    await interaction
      .editReply({ content: newContent, components: [] })
      .catch((err) => logError(`failed to edit message after button click: ${String(err)}`));
  });

  return {
    // `event` is typed loosely here on purpose: live testing showed the
    // real server emits event types ("permission.asked", "question.asked")
    // that don't appear in @opencode-ai/sdk's published Event union at
    // all. Matching on the raw string is the reliable path.
    async event(input: { event: { type: string; properties?: any } }) {
      const event = input.event;
      try {
        if (event.type === "permission.asked") {
          const sessionId = event.properties?.sessionID;
          const permissionId = event.properties?.id;
          if (sessionId && permissionId) {
            ownedPermissions.add(permissionId);
            const buttons = buildPermissionButtons(sessionId, permissionId);
            await safeSend(formatPermissionAsked(event.properties, label), [buttons]);
          } else {
            await logError(`permission.asked event missing sessionID/id, notifying without buttons: ${JSON.stringify(event.properties)}`);
            await safeSend(formatPermissionAsked(event.properties, label));
          }
          return;
        }

        if (event.type === "session.idle") {
          await safeSend(formatSessionIdle(label));
          return;
        }

        if (event.type === "message.part.updated" || event.type === "message.updated") {
          const part = findQuestionPart(event.properties);
          if (part?.state?.status === "pending") {
            const id = part.id ?? part.callID;
            if (id && !notifiedQuestionIds.has(id)) {
              notifiedQuestionIds.add(id);
              await safeSend(formatQuestionPending(part, label));
            }
          }
        }
      } catch (err) {
        await logError(`error handling event ${event.type}: ${String(err)}`);
      }
    },

    async dispose() {
      await notifier.destroy().catch((err) => logError(`error during dispose: ${String(err)}`));
    },
  };
};

export default DiscordNotifierPlugin;
