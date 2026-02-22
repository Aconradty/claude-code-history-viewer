import type { ClaudeAssistantMessage, ClaudeMessage } from "../types";

export interface SessionExportMeta {
  sessionName: string;
  projectName: string;
  projectPath: string;
  providerId: string;
}

const PROVIDER_DISPLAY: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  opencode: "OpenCode",
};

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function formatDuration(ms: number): string {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function formatTokens(usage: {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): string {
  const parts: string[] = [];
  if (usage.input_tokens) parts.push(`${usage.input_tokens.toLocaleString()} in`);
  if (usage.output_tokens) parts.push(`${usage.output_tokens.toLocaleString()} out`);
  if (usage.cache_read_input_tokens)
    parts.push(`${usage.cache_read_input_tokens.toLocaleString()} cache read`);
  return parts.join(" · ");
}

function getToolSummaryLine(block: {
  name: string;
  input: Record<string, unknown>;
}): string {
  const { name, input } = block;

  if (name === "Skill") {
    const skill = String(input.skill ?? "");
    const args = input.args ? ` — \`${String(input.args)}\`` : "";
    return `> 🔧 **Skill:** \`${skill}\`${args}`;
  }

  const keyArg =
    (input.file_path as string) ??
    (input.path as string) ??
    (input.command as string) ??
    (input.query as string) ??
    "";
  return `> 🔧 **${name}**${keyArg ? ` \`${keyArg}\`` : ""}`;
}

function renderContentBlock(block: Record<string, unknown>): string {
  switch (block.type) {
    case "text":
      return String(block.text ?? "");
    case "tool_use":
      return getToolSummaryLine(
        block as { name: string; input: Record<string, unknown> },
      );
    case "thinking":
      return `<details>\n<summary>💭 Thinking</summary>\n\n${block.thinking}\n\n</details>`;
    case "redacted_thinking":
      return `<details>\n<summary>💭 Thinking (redacted)</summary>\n\n_Content redacted by safety systems._\n\n</details>`;
    case "image":
      return `[image: ${block.source ? (block.source as Record<string, unknown>).media_type : "unknown"}]`;
    case "tool_result": {
      const content = String(block.content ?? "");
      const lines = content.split("\n").length;
      return `[tool_result: ${block.tool_use_id} — ${lines} line${lines !== 1 ? "s" : ""}]`;
    }
    default:
      return `[${block.type}]`;
  }
}

function renderMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => renderContentBlock(block as Record<string, unknown>))
    .filter(Boolean)
    .join("\n\n");
}

export function sessionToMarkdown(
  messages: ClaudeMessage[],
  meta: SessionExportMeta,
): string {
  // The Tauri backend flattens messages: content, usage, model etc. are at root level
  const visible = messages.filter((m) => !m.isSidechain);

  const firstTimestamp = visible[0]?.timestamp;
  const lastTimestamp = visible[visible.length - 1]?.timestamp;
  const durationMs =
    firstTimestamp && lastTimestamp
      ? new Date(lastTimestamp).getTime() - new Date(firstTimestamp).getTime()
      : null;

  // Find first assistant message for model info
  const firstAssistant = visible.find((m) => m.type === "assistant") as
    | ClaudeAssistantMessage
    | undefined;
  const model = firstAssistant?.model ?? "";

  // Aggregate tokens across all assistant messages
  let totalIn = 0,
    totalOut = 0,
    totalCacheRead = 0;
  visible
    .filter((m) => m.type === "assistant")
    .forEach((m) => {
      const usage = (m as ClaudeAssistantMessage).usage;
      if (usage) {
        totalIn += usage.input_tokens ?? 0;
        totalOut += usage.output_tokens ?? 0;
        totalCacheRead += usage.cache_read_input_tokens ?? 0;
      }
    });

  const totalCost = visible.reduce(
    (sum, m) => sum + ((m as ClaudeAssistantMessage).costUSD ?? 0),
    0,
  );

  const lines: string[] = [
    `# ${meta.sessionName}`,
    "",
    `**Project:** \`${meta.projectPath}\``,
    `**Provider:** ${PROVIDER_DISPLAY[meta.providerId] ?? meta.providerId}`,
    firstTimestamp ? `**Date:** ${formatDate(firstTimestamp)}` : "",
    durationMs != null ? `**Duration:** ${formatDuration(durationMs)}` : "",
    model ? `**Model:** ${model}` : "",
    totalIn + totalOut > 0
      ? `**Tokens:** ${formatTokens({ input_tokens: totalIn, output_tokens: totalOut, cache_read_input_tokens: totalCacheRead })}`
      : "",
    totalCost > 0 ? `**Cost:** $${totalCost.toFixed(4)}` : "",
    "",
    "---",
    "",
  ].filter((l) => l !== undefined && l !== null);

  if (visible.length === 0) {
    lines.push("_No messages_");
    return lines.join("\n");
  }

  for (const msg of visible) {
    const time = formatTimestamp(msg.timestamp);

    if (msg.type === "user") {
      lines.push(`## User · ${time}`, "");
      lines.push(renderMessageContent(msg.content), "");
      lines.push("---", "");
    } else if (msg.type === "assistant") {
      const am = msg as ClaudeAssistantMessage;
      const usage = am.usage;
      const tokenStr = usage ? formatTokens(usage) : "";
      const durationStr = am.durationMs ? formatDuration(am.durationMs) : "";
      const meta2 = [tokenStr, durationStr].filter(Boolean).join(" · ");
      lines.push(`## Assistant · ${time}${meta2 ? ` · ${meta2}` : ""}`, "");
      lines.push(renderMessageContent(am.content), "");
      if (am.costUSD && am.costUSD > 0) {
        lines.push(`> 💰 $${am.costUSD.toFixed(4)}`, "");
      }
      lines.push("---", "");
    } else if (msg.type === "summary") {
      lines.push(`## Summary`, "");
      lines.push(
        `_${typeof msg.content === "string" ? msg.content : ""}_`,
        "",
      );
      lines.push("---", "");
    }
  }

  return lines.join("\n");
}
