import type { WorkspaceState } from '../types/workspace';
import type { TornadoScenario } from '../types/scenario';

export interface SavedScenarioEntry {
  id: string;
  name: string;
  region: string;
  efScale: number;
  pathLengthMiles: number;
  updatedAt: string;
  ws: WorkspaceState;
  scenario: TornadoScenario;
}

const STORAGE_KEY = 'tornadoready-saved-scenarios';

export function getSavedScenarios(): SavedScenarioEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScenario(entry: SavedScenarioEntry): void {
  const existing = getSavedScenarios();
  const idx = existing.findIndex((s) => s.id === entry.id);
  if (idx >= 0) {
    existing[idx] = entry;
  } else {
    existing.push(entry);
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}

export function getSavedScenario(id: string): SavedScenarioEntry | undefined {
  return getSavedScenarios().find((s) => s.id === id);
}
