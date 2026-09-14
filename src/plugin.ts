import { MessageFlags } from "discord.js";
import { define, type Context } from "@opencode/plugin/promise/plugin";
import { buildPermissionButtons, parsePermissionCustomId } from "./buttons.js";
import { loadConfig, NotConfiguredError, type NotifierConfig } from "./config.js";
import { createDiscordNotifier, type Notifier } from "./discord.js";
import {
  appendPermissionOutcome,
  formatExecutionSucceeded,
  formatFormCreated,
  formatPermissionAsked,
  projectLabel,
} from "./format.js";

const SERVICE = "opencode-discord-notifier";

// v1's client.app.log() wrote into OpenCode's own persistent log because
// plain console output never reached anywhere a user could see it. Under v2,
// confirmed live that console.error output from a plugin running in the
// interactive TUI's server subprocess does NOT reliably surface anywhere
// (not the terminal, not the log file) — unlike one-shot `opencode run`,
// where it does. No reliable log destination found for the interactive
// path; errors here are best-effort only.
function logError(message: string) {
  console.error(`[${SERVICE}] ${message}`);
}

// v2 boots a separate "location" context per directory it sees a client
// connect from — confirmed live: a single `opencode` invocation in a project
// directory produces both a project-directory location AND a bare-home-
// directory location, and a globally-configured plugin like this one gets
// setup() called once per location, all within the same process. Without a
// guard, that means N independent Discord clients, each reacting to the same
// global event stream — confirmed live as duplicate Discord messages and a
// race between instances answering the same button click (one succeeds, the
// other gets a stale "permission not found"). Module-level state is safe
// here because every location's plugin instance runs in the same process.
let active: { readonly directory: string } | undefined;

export default define({
  id: SERVICE,
  async setup(context: Context) {
    if (active) {
      logError(
        `skipping duplicate instance for location ${context.location.directory} — already active for ${active.directory}`,
      );
      return;
    }
    // Claim the slot synchronously, before any await — JS's single-threaded
    // execution makes this check-and-claim atomic. Claiming it only after
    // createDiscordNotifier() resolves (as a first attempt at this guard
    // did) left a real race: two locations' setup() calls can both pass the
    // `if (active)` check before either finishes its async login, since
    // neither has claimed the slot yet — confirmed live as two Discord
    // clients both getting created despite the guard.
    active = { directory: context.location.directory };

    let config: NotifierConfig;
    let notifier: Notifier;
    try {
      config = loadConfig();
      notifier = await createDiscordNotifier(config);
    } catch (err) {
      active = undefined; // release the slot so a later location can take over
      if (err instanceof NotConfiguredError) {
        // Expected right after installing the plugin, before the user has
        // set up a config file or env vars — not a failure.
        return;
      }
      logError(`failed to start: ${err instanceof Error ? err.message : String(err)}`);
      // Degrade gracefully: no-op rather than throwing, so the rest of
      // OpenCode is unaffected by a misconfigured notifier.
      return;
    }
    active = { directory: context.location.directory };

    const label = projectLabel(context.location.directory, context.location.project.canonical);
    const notifiedFormIds = new Set<string>();
    // Permission IDs this specific plugin instance actually sent a
    // notification for. Discord broadcasts every button click to every
    // connected session on this bot token (confirmed live under v1, and the
    // underlying Discord behavior hasn't changed), so this set is what lets
    // each concurrent `opencode` session only act on its own pending
    // permissions. Entries are kept for the process's lifetime (not deleted
    // after one click) so a second/duplicate click on an already-answered
    // permission still routes through the real API call and gets a clean
    // "already answered" response, rather than being silently dropped as
    // "not mine."
    const ownedPermissions = new Set<string>();

    async function safeSend(content: string, components?: Parameters<typeof notifier.send>[1]) {
      try {
        await notifier.send(content, components);
      } catch (err) {
        logError(`failed to send Discord message: ${String(err)}`);
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
      // even though the click was received (confirmed live under v1).
      await interaction.deferUpdate();

      const originalContent = interaction.message.content;
      let newContent: string;
      try {
        // v2's reply() returns Promise<void> and throws on failure — the raw
        // parsed error body (e.g. {_tag: "PermissionNotFoundError"}), not
        // v1's {data, error} shape. Same _tag check, now via catch.
        await context.permission.reply({
          sessionID: parsed.sessionId,
          requestID: parsed.permissionId,
          reply: parsed.action,
        });
        newContent = appendPermissionOutcome(originalContent, { kind: "success", action: parsed.action });
      } catch (err) {
        // v2's reply() throws the raw parsed error body on failure (e.g.
        // {_tag: "PermissionNotFoundError", message: "..."}), not v1's
        // {data, error} shape — same case this always handled, just via
        // catch now. Matching on message content too, not just _tag: with
        // the setup() singleton guard now in place there should only ever
        // be one instance replying, but a genuine double-click (or a
        // keyboard answer racing a Discord click) can still hit this.
        const tag = (err as any)?._tag;
        const message = (err as any)?.message ?? String(err);
        if (tag === "PermissionNotFoundError" || /not found/i.test(message)) {
          newContent = appendPermissionOutcome(originalContent, { kind: "already-answered" });
        } else {
          newContent = appendPermissionOutcome(originalContent, { kind: "error", message });
        }
      }

      await interaction
        .editReply({ content: newContent, components: [] })
        .catch((err) => logError(`failed to edit message after button click: ${String(err)}`));
    });

    // v1 was a hook the host called per-event. v2's event API is a pull-based
    // async iterable instead, so the plugin owns its own subscription loop.
    const controller = new AbortController();
    (async () => {
      try {
        for await (const event of context.event.subscribe({ signal: controller.signal })) {
          try {
            if (event.type === "permission.asked") {
              const { sessionID, id: permissionId } = event.data;
              ownedPermissions.add(permissionId);
              const buttons = buildPermissionButtons(sessionID, permissionId);
              await safeSend(formatPermissionAsked(event.data, label), [buttons]);
              continue;
            }

            if (event.type === "session.execution.succeeded") {
              await safeSend(formatExecutionSucceeded(label));
              continue;
            }

            if (event.type === "form.created") {
              const form = event.data.form;
              if (!notifiedFormIds.has(form.id)) {
                notifiedFormIds.add(form.id);
                await safeSend(formatFormCreated(form, label));
              }
            }
          } catch (err) {
            logError(`error handling event ${event.type}: ${String(err)}`);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          logError(`event subscription ended unexpectedly: ${String(err)}`);
        }
      }
    })();

    return async () => {
      controller.abort();
      await notifier.destroy().catch((err) => logError(`error during dispose: ${String(err)}`));
      if (active?.directory === context.location.directory) active = undefined;
    };
  },
});
