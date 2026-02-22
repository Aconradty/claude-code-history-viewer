import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ExportSessionInfo } from "../store/slices/exportSlice";

const mockExportSessions = vi.fn();
const mockClearExportSelection = vi.fn();

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      // Return human-readable strings for button labels to avoid regex collisions
      if (k === "session.export.exportButton") return "Export";
      if (k === "session.export.clearButton") return "Clear";
      return opts ? `${k}:${JSON.stringify(opts)}` : k;
    },
  }),
}));

const mockSelectedSessions = new Map<string, ExportSessionInfo>();
vi.mock("@/store/useAppStore", () => ({
  useAppStore: (
    selector: (s: {
      selectedExportSessions: Map<string, ExportSessionInfo>;
      clearExportSelection: () => void;
    }) => unknown,
  ) =>
    selector({
      selectedExportSessions: mockSelectedSessions,
      clearExportSelection: mockClearExportSelection,
    }),
}));

vi.mock("@/hooks/useExportSessions", () => ({
  useExportSessions: () => ({ exportSessions: mockExportSessions }),
}));

import { ExportActionBar } from "../components/ExportActionBar";

describe("ExportActionBar", () => {
  it("renders nothing when no sessions selected", () => {
    mockSelectedSessions.clear();
    const { container } = render(<ExportActionBar />);
    expect(container.firstChild).toBeNull();
  });

  it("renders action bar when sessions are selected", () => {
    mockSelectedSessions.set("/a.jsonl", {
      sessionName: "A",
      projectName: "p",
      projectPath: "/p",
      providerId: "claude",
    });
    render(<ExportActionBar />);
    expect(
      screen.getByRole("button", { name: /export/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("calls exportSessions on Export click", () => {
    mockSelectedSessions.set("/a.jsonl", {
      sessionName: "A",
      projectName: "p",
      projectPath: "/p",
      providerId: "claude",
    });
    render(<ExportActionBar />);
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(mockExportSessions).toHaveBeenCalled();
  });

  it("calls clearExportSelection on Clear click", () => {
    mockSelectedSessions.set("/a.jsonl", {
      sessionName: "A",
      projectName: "p",
      projectPath: "/p",
      providerId: "claude",
    });
    render(<ExportActionBar />);
    fireEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(mockClearExportSelection).toHaveBeenCalled();
  });
});
