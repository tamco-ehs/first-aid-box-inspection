// =============================================================================
// Top-up request construction + de-duplication. Pure logic (no I/O): the route
// supplies the set of ALREADY-OPEN top-up keys (queried from the DB) and the
// evaluated lines; this decides which new top-up rows to create. Prevents
// duplicate open requests for the same box + same item, and also de-dupes
// within a single submission.
// =============================================================================

import type { EvaluatedItem, Priority, VolumeLevel } from './types.ts';

export interface TopupRow {
  box_id: string;
  inspection_id: string;
  inspection_item_id: string | null;
  item_name: string;
  reason: string;
  required_quantity: number | null;
  observed_quantity: number | null;
  observed_volume_level: VolumeLevel | null;
  expiry_date: string | null;
  priority: Priority;
  status: 'Open';
  requested_by: string | null;
}

/**
 * De-dup key. topup_requests stores item_name (not box_item_id), and box items
 * are name-unique per box (unique index on box_id + lower(item_name)), so the
 * item name is a reliable per-box key that matches both new and existing rows.
 */
export function topupKey(itemName: string): string {
  return `name:${itemName.trim().toLowerCase()}`;
}

export interface BuildTopupParams {
  boxId: string;
  inspectionId: string;
  requestedBy: string | null;
  lines: Array<{ evaluated: EvaluatedItem; inspectionItemId: string | null }>;
  /** Keys of top-ups already Open/In Progress for this box (from the DB). */
  existingOpenKeys: Set<string>;
}

export function buildTopupRows(params: BuildTopupParams): TopupRow[] {
  const rows: TopupRow[] = [];
  const seen = new Set<string>(params.existingOpenKeys);

  for (const { evaluated, inspectionItemId } of params.lines) {
    if (!evaluated.topup_required) continue;

    const key = topupKey(evaluated.item_name);
    if (seen.has(key)) continue; // already open, or already added in this batch
    seen.add(key);

    rows.push({
      box_id: params.boxId,
      inspection_id: params.inspectionId,
      inspection_item_id: inspectionItemId,
      item_name: evaluated.item_name,
      reason: evaluated.reason,
      required_quantity: evaluated.required_quantity,
      observed_quantity: evaluated.observed_quantity,
      observed_volume_level: evaluated.observed_volume_level,
      expiry_date: evaluated.expiry_date,
      priority: evaluated.priority,
      status: 'Open',
      requested_by: params.requestedBy,
    });
  }

  return rows;
}
