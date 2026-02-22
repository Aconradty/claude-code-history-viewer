import { describe, it, expect } from "vitest";
import { sessionToMarkdown, type SessionExportMeta } from "../utils/sessionToMarkdown";
import type { ClaudeMessage } from "../types";

const meta: SessionExportMeta = {
  sessionName: "Test Session",
  projectName: "my-app",
  projectPath: "/Users/me/my-app",
  providerId: "claude",
};

// Tauri backend flattens the nested `message` object — content, usage, model etc.
// are at the root level of ClaudeMessage, NOT under a `message` property.
const makeUser = (content: string): ClaudeMessage =>
  ({
    uuid: "u1",
    sessionId: "session1",
    type: "user",
    timestamp: "2026-01-15T14:32:01.000Z",
    content,
  }) as unknown as ClaudeMessage;

const makeAssistant = (text: string): ClaudeMessage =>
  ({
    uuid: "a1",
    sessionId: "session1",
    type: "assistant",
    timestamp: "2026-01-15T14:32:08.000Z",
    content: [{ type: "text", text }],
    model: "claude-opus-4-5",
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    costUSD: 0.01,
    durationMs: 3200,
  }) as unknown as ClaudeMessage;

describe("sessionToMarkdown", () => {
  it("includes the session header with metadata", () => {
    const result = sessionToMarkdown([makeUser("Hello")], meta);
    expect(result).toContain("# Test Session");
    expect(result).toContain("**Project:**");
    expect(result).toContain("/Users/me/my-app");
    expect(result).toContain("**Provider:** Claude Code");
  });

  it("renders a user text message", () => {
    const result = sessionToMarkdown([makeUser("Hello world")], meta);
    expect(result).toContain("## User");
    expect(result).toContain("Hello world");
  });

  it("renders an assistant text message with tokens and cost", () => {
    const result = sessionToMarkdown([makeAssistant("I can help")], meta);
    expect(result).toContain("## Assistant");
    expect(result).toContain("I can help");
    expect(result).toContain("100 in");
    expect(result).toContain("50 out");
    expect(result).toContain("$0.01");
    expect(result).toContain("3.2s");
  });

  it("renders tool_use as a summary line", () => {
    const msg: ClaudeMessage = {
      uuid: "a2",
      sessionId: "session1",
      type: "assistant",
      timestamp: "2026-01-15T14:33:00.000Z",
      content: [
        {
          type: "tool_use",
          id: "toolu_123",
          name: "Read",
          input: { file_path: "src/index.ts" },
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).toContain("🔧 **Read**");
    expect(result).toContain("src/index.ts");
  });

  it("renders Skill tool_use with skill name and args", () => {
    const msg: ClaudeMessage = {
      uuid: "a4",
      sessionId: "session1",
      type: "assistant",
      timestamp: "2026-01-15T14:33:00.000Z",
      content: [
        {
          type: "tool_use",
          id: "toolu_skill_1",
          name: "Skill",
          input: { skill: "sessions", args: "log export-skill-rendering" },
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).toContain("🔧 **Skill:**");
    expect(result).toContain("`sessions`");
    expect(result).toContain("`log export-skill-rendering`");
  });

  it("renders Skill tool_use with skill name only when no args", () => {
    const msg: ClaudeMessage = {
      uuid: "a5",
      sessionId: "session1",
      type: "assistant",
      timestamp: "2026-01-15T14:33:00.000Z",
      content: [
        {
          type: "tool_use",
          id: "toolu_skill_2",
          name: "Skill",
          input: { skill: "sessions" },
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).toContain("🔧 **Skill:**");
    expect(result).toContain("`sessions`");
    expect(result).not.toContain(" — ");
  });

  it("renders thinking blocks as collapsed details", () => {
    const msg: ClaudeMessage = {
      uuid: "a3",
      sessionId: "session1",
      type: "assistant",
      timestamp: "2026-01-15T14:34:00.000Z",
      content: [{ type: "thinking", thinking: "Let me think about this..." }],
      usage: {
        input_tokens: 10,
        output_tokens: 5,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).toContain("<details>");
    expect(result).toContain("💭 Thinking");
    expect(result).toContain("Let me think about this...");
    expect(result).toContain("</details>");
  });

  it("renders tool_result in user messages as a summary", () => {
    const msg: ClaudeMessage = {
      uuid: "u2",
      sessionId: "session1",
      type: "user",
      timestamp: "2026-01-15T14:35:00.000Z",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_123",
          content: "file content here\nline 2",
        },
      ],
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).toContain("[tool_result:");
    expect(result).not.toContain("file content here");
  });

  it("skips sidechain messages", () => {
    const msg: ClaudeMessage = {
      uuid: "s1",
      sessionId: "session1",
      type: "user",
      isSidechain: true,
      timestamp: "2026-01-15T14:36:00.000Z",
      content: "sidechain content",
    } as unknown as ClaudeMessage;
    const result = sessionToMarkdown([msg], meta);
    expect(result).not.toContain("sidechain content");
  });

  it("returns empty-session notice when no messages", () => {
    const result = sessionToMarkdown([], meta);
    expect(result).toContain("# Test Session");
    expect(result).toContain("_No messages_");
  });
});
