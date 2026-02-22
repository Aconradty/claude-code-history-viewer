import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// vi.hoisted ensures these are available when vi.mock factories run (hoisted to top)
const { mockInvoke, mockOpen, mockToast, mockStore } = vi.hoisted(() => {
  const mockToast = {
    loading: vi.fn().mockReturnValue("toast-id"),
    success: vi.fn(),
    error: vi.fn(),
    dismiss: vi.fn(),
  };
  const mockInvoke = vi.fn();
  const mockOpen = vi.fn();
  const mockStore = {
    selectedExportSessions: new Map([
      [
        "/path/session-a.jsonl",
        {
          sessionName: "Session A",
          projectName: "proj",
          projectPath: "/proj",
          providerId: "claude",
        },
      ],
    ]),
    setIsExporting: vi.fn(),
    setExportProgress: vi.fn(),
    clearExportSelection: vi.fn(),
  };
  return { mockInvoke, mockOpen, mockToast, mockStore };
});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mockToast }));
vi.mock("@/store/useAppStore", () => ({
  useAppStore: (selector: (s: typeof mockStore) => unknown) =>
    selector(mockStore),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) =>
      `${k}:${JSON.stringify(opts ?? {})}`,
  }),
}));

import { useExportSessions } from "../hooks/useExportSessions";

describe("useExportSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.loading.mockReturnValue("toast-id");
  });

  it("does nothing if no folder selected", async () => {
    mockOpen.mockResolvedValue(null);
    const { result } = renderHook(() => useExportSessions());
    await act(() => result.current.exportSessions());
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("loads messages and writes file for each session", async () => {
    mockOpen.mockResolvedValue("/Users/me/exports");
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === "load_session_messages") return Promise.resolve([]);
      if (cmd === "write_text_file") return Promise.resolve();
      return Promise.reject(new Error(`Unknown command: ${cmd}`));
    });

    const { result } = renderHook(() => useExportSessions());
    await act(() => result.current.exportSessions());

    expect(mockInvoke).toHaveBeenCalledWith(
      "load_session_messages",
      expect.objectContaining({ sessionPath: "/path/session-a.jsonl" }),
    );
    expect(mockStore.setIsExporting).toHaveBeenCalledWith(true);
    expect(mockStore.setIsExporting).toHaveBeenCalledWith(false);
  });
});
