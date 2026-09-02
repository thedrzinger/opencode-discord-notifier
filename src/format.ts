import { basename } from "node:path";

// The real event payloads observed live diverge from the published SDK
// types (see project notes) — these are intentionally loose/defensive
// rather than typed against @opencode-ai/sdk's Event union.

export function projectLabel(directory: string | undefined, worktree: string | undefined): string {
  const path = worktree ?? directory;
  return path ? basename(path) : "unknown project";
}

export function formatPermissionAsked(properties: any, label: string): string {
  const command: string | undefined = properties?.metadata?.command;
  const patterns: string[] | undefined = properties?.patterns;
  const detail = command ?? patterns?.join(", ") ?? properties?.permission ?? "an action";
  const kind = properties?.permission ?? "permission";
  return `🔐 **Permission needed** in \`${label}\`\n${kind}: \`${detail}\``;
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

export function formatSessionIdle(label: string): string {
  return `✅ Session in \`${label}\` finished and is waiting for you.`;
}

export function formatQuestionPending(part: any, label: string): string {
  const question = part?.state?.input?.questions?.[0];
  const text: string = question?.question ?? "OpenCode has a question for you.";
  const options: Array<{ label?: string; description?: string }> = question?.options ?? [];
  const optionLines = options
    .map((opt, i) => `  ${i + 1}. ${opt.label ?? "(option)"}${opt.description ? ` — ${opt.description}` : ""}`)
    .join("\n");
  return (
    `❓ **Question pending** in \`${label}\`\n` +
    `${text}` +
    (optionLines ? `\n${optionLines}` : "") +
    `\n\nThis has to be answered from the keyboard — Discord can't answer it (see project notes).`
  );
}
