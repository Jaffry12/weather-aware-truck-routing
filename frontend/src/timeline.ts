import { useSyncExternalStore } from "react";

/**
 * The forecast time being shown, in fractional hours after the heatmap start.
 * Playback changes it every animation frame, so it lives outside React state:
 * only the slider and the map subscribe, and the rest of the app never re-renders.
 */
export interface Timeline {
  get(): number;
  set(hours: number): void;
  subscribe(listener: () => void): () => void;
}

export function createTimeline(): Timeline {
  let hours = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => hours,
    set(value) {
      if (value === hours) return;
      hours = value;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const useTimeline = (timeline: Timeline): number => useSyncExternalStore(timeline.subscribe, timeline.get);
