'use client';

// Offline-resilient quick-inspection draft, stored per box in localStorage.
// Guarantees "start an inspection in weak signal and don't lose data": every
// change is saved locally; a failed submit keeps the draft for retry.

import type { ItemCheckStatus } from './types.ts';

export interface ItemDraft {
  status?: ItemCheckStatus;
  observed_quantity?: number | null;
  new_expiry_date?: string | null;
  remark?: string | null;
}

export interface QuickDraft {
  boxId: string;
  updatedAt: number;
  answers: {
    box_accessible: boolean | null;
    box_clean: boolean | null;
    seal_intact: boolean | null;
    contact_visible: boolean | null;
  };
  notes: string;
  items: Record<string, ItemDraft>;
}

const key = (boxId: string) => `fais:draft:${boxId}`;

export function emptyDraft(boxId: string): QuickDraft {
  return {
    boxId,
    updatedAt: Date.now(),
    answers: { box_accessible: null, box_clean: null, seal_intact: null, contact_visible: null },
    notes: '',
    items: {},
  };
}

export function loadDraft(boxId: string): QuickDraft | null {
  try {
    const raw = localStorage.getItem(key(boxId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as QuickDraft;
    if (parsed && parsed.boxId === boxId && parsed.answers && typeof parsed.items === 'object') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function saveDraft(draft: QuickDraft): void {
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
