import { describe, it, expect } from "vitest";
import { create } from "zustand";
import {
  createExportSlice,
  initialExportState,
  type ExportSlice,
  type ExportSessionInfo,
} from "../store/slices/exportSlice";

const createTestStore = () =>
  create<ExportSlice>()((set, get) => ({
    ...createExportSlice(
      set as unknown as Parameters<typeof createExportSlice>[0],
      get as unknown as Parameters<typeof createExportSlice>[1]
    ),
  }));

describe("exportSlice", () => {
  it("starts with empty selection", () => {
    const store = createTestStore();
    expect(store.getState().selectedExportSessions.size).toBe(0);
    expect(store.getState().isExporting).toBe(false);
    expect(store.getState().exportProgress).toBeNull();
  });

  it("toggleExportSession adds a session", () => {
    const store = createTestStore();
    const info: ExportSessionInfo = {
      sessionName: "My Session",
      projectName: "my-app",
      projectPath: "/Users/me/my-app",
      providerId: "claude",
    };
    store.getState().toggleExportSession("/path/to/session.jsonl", info);
    expect(store.getState().selectedExportSessions.size).toBe(1);
    expect(store.getState().selectedExportSessions.get("/path/to/session.jsonl")).toEqual(info);
  });

  it("toggleExportSession removes an already-selected session", () => {
    const store = createTestStore();
    const info: ExportSessionInfo = {
      sessionName: "My Session",
      projectName: "my-app",
      projectPath: "/Users/me/my-app",
      providerId: "claude",
    };
    store.getState().toggleExportSession("/path/to/session.jsonl", info);
    store.getState().toggleExportSession("/path/to/session.jsonl", info);
    expect(store.getState().selectedExportSessions.size).toBe(0);
  });

  it("clearExportSelection empties the map", () => {
    const store = createTestStore();
    const info: ExportSessionInfo = {
      sessionName: "S", projectName: "p", projectPath: "/p", providerId: "claude",
    };
    store.getState().toggleExportSession("/a.jsonl", info);
    store.getState().clearExportSelection();
    expect(store.getState().selectedExportSessions.size).toBe(0);
  });

  it("setExportProgress updates progress", () => {
    const store = createTestStore();
    store.getState().setExportProgress({ current: 2, total: 5 });
    expect(store.getState().exportProgress).toEqual({ current: 2, total: 5 });
  });
});

// Verify initialExportState is exported
it("initialExportState is exported", () => {
  expect(initialExportState.selectedExportSessions.size).toBe(0);
  expect(initialExportState.isExporting).toBe(false);
  expect(initialExportState.exportProgress).toBeNull();
});
