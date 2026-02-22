import type { StateCreator } from "zustand";
import type { FullAppStore } from "./types";

export interface ExportSessionInfo {
  sessionName: string;
  projectName: string;
  projectPath: string;
  providerId: string;
}

export interface ExportSliceState {
  selectedExportSessions: Map<string, ExportSessionInfo>; // key = filePath
  isExporting: boolean;
  exportProgress: { current: number; total: number } | null;
}

export interface ExportSliceActions {
  toggleExportSession: (filePath: string, info: ExportSessionInfo) => void;
  clearExportSelection: () => void;
  setIsExporting: (exporting: boolean) => void;
  setExportProgress: (progress: { current: number; total: number } | null) => void;
}

export type ExportSlice = ExportSliceState & ExportSliceActions;

export const initialExportState: ExportSliceState = {
  selectedExportSessions: new Map(),
  isExporting: false,
  exportProgress: null,
};

export const createExportSlice: StateCreator<
  FullAppStore,
  [],
  [],
  ExportSlice
> = (set) => ({
  ...initialExportState,

  toggleExportSession: (filePath, info) => {
    set((state) => {
      const next = new Map(state.selectedExportSessions);
      if (next.has(filePath)) {
        next.delete(filePath);
      } else {
        next.set(filePath, info);
      }
      return { selectedExportSessions: next };
    });
  },

  clearExportSelection: () => {
    set({ selectedExportSessions: new Map() });
  },

  setIsExporting: (isExporting) => set({ isExporting }),

  setExportProgress: (exportProgress) => set({ exportProgress }),
});
