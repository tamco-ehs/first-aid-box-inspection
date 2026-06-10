'use client';

// Offline-resilient inspection draft, stored per box in localStorage. This is
// what guarantees "start an inspection in weak signal and don't lose data":
// every change is saved locally; a failed submit keeps the draft for retry.

import type { PresentStatus, VolumeLevel } from '@/lib/logic/types.ts';

export interface DraftObservation {
  observed_quantity?: number | null;
  observed_volume_level?: VolumeLevel | null;
  observed_present_status?: PresentStatus | null;
  expiry_date?: string | null;
  remarks?: string | null;
}

export interface InspectionDraft {
  boxId: string;
  updatedAt: number;
  notes: string;
  observations: Record<string, DraftObservation>;
  photoUrl?: string | null;
  photoPublicId?: string | null;
}

const key = (boxId: string) => `fais:draft:${boxId}`;

export function loadDraft(boxId: string): InspectionDraft | null {
  try {
    const raw = localStorage.getItem(key(boxId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as InspectionDraft;
    if (parsed && parsed.boxId === boxId && typeof parsed.observations === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: InspectionDraft): void {
  try {
    localStorage.setItem(key(draft.boxId), JSON.stringify({ ...draft, updatedAt: Date.now() }));
  } catch {
    /* storage full / unavailable - non-fatal */
  }
}

export function clearDraft(boxId: string): void {
  try {
    localStorage.removeItem(key(boxId));
  } catch {
    /* ignore */
  }
}
