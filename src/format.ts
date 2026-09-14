import { basename } from "node:path";

export function projectLabel(directory: string | undefined, worktree: string | undefined): string {
  const path = worktree ?? directory;
  return path ? basename(path) : "unknown project";
}

// v2's PermissionAsked.data shape — see @opencode/client's generated types.
// Deliberately not importing the type itself (would add @opencode/client as
// a direct dependency just for one type); the shape is stable/documented now,
// unlike v1 where it had to be treated as untyped.
export function formatPermissionAsked(
  data: { action: string; resources?: string[]; message?: string },
  label: string,
): string {
  const detail = data.message ?? data.resources?.join(", ") ?? "an action";
  return `🔐 **Permission needed** in \`${label}\`\n${data.action}: \`${detail}\``;
}

const ACTION_LABEL: Record<"once" | "always" | "reject", string> = {
  once: "Once",
  always: "Always",
  reject: "Reject",
};

export function appendPermissionOutcome(
  originalContent: string,
  outcome: { kind: "success"; action: "once" | "always" | "reject" } | { kind: "already-answered" } | { kind: "error"; message: string },
): string {
  if (outcome.kind === "success") {
    return `${originalContent}\n\n✅ You replied **${ACTION_LABEL[outcome.action]}**.`;
  }
  if (outcome.kind === "already-answered") {
    return `${originalContent}\n\n⚠️ Already answered — probably from the keyboard.`;
  }
  return `${originalContent}\n\n⚠️ Something went wrong: ${outcome.message}`;
}

// v1 fired on a "session.idle" event. v2 doesn't appear to emit that event at
// all — confirmed live: waited 45+ seconds of genuine post-response silence
// with no session.idle ever arriving. "session.execution.succeeded" is what
// actually fires exactly when the agent finishes its turn and hands control
// back, which is the same moment v1's session.idle notification meant to
// catch.
export function formatExecutionSucceeded(label: string): string {
  return `✅ Session in \`${label}\` finished and is waiting for you.`;
}

// v1 detected a pending "question" tool-call part via an undocumented
// heuristic (see git history). v2 formalized this as a first-class "form"
// system (form.created event) — this targets that instead.
export function formatFormCreated(
  form: { title: string; fields: ReadonlyArray<{ key: string; title?: string }> },
  label: string,
): string {
  const fieldLines = form.fields
    .map((field, i) => `  ${i + 1}. ${field.title ?? field.key}`)
    .join("\n");
  return (
    `❓ **Input needed** in \`${label}\`\n` +
    `${form.title}` +
    (fieldLines ? `\n${fieldLines}` : "") +
    `\n\nThis has to be answered from the keyboard — Discord can't answer it (see project notes).`
  );
}
