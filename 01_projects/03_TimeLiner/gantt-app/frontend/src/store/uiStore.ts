import { create } from "zustand";

import type { Scale } from "../types/domain";

interface UiState {
  scale: Scale;
  tableWidth: number;
  selectedTaskId: string | null;
  focusRequest: { taskId: string; requestId: number } | null;
  timelineCenterTime: number | null;
  setScale: (scale: Scale) => void;
  setTableWidth: (tableWidth: number) => void;
  selectTask: (taskId: string | null) => void;
  focusTask: (taskId: string) => void;
  setTimelineCenterTime: (timelineCenterTime: number) => void;
}

export const useUiStore = create<UiState>((set) => ({
  scale: "month",
  tableWidth: 520,
  selectedTaskId: null,
  focusRequest: null,
  timelineCenterTime: null,
  setScale: (scale) => set({ scale }),
  setTableWidth: (tableWidth) => set({ tableWidth }),
  selectTask: (selectedTaskId) => set({ selectedTaskId }),
  focusTask: (taskId) =>
    set((state) => ({
      focusRequest: { taskId, requestId: (state.focusRequest?.requestId ?? 0) + 1 },
    })),
  setTimelineCenterTime: (timelineCenterTime) => set({ timelineCenterTime }),
}));
