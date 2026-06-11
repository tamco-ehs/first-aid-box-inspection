// =============================================================================
// Inspection status calculation - the authoritative, server-side scoring of an
// inspection. Pure functions only (no I/O), so they are deterministic and
// fully unit-tested in inspection.test.ts. The API route NEVER trusts statuses
// computed by the client; it recomputes here from the stored box_items spec.
// =============================================================================

import type {
  BoxItemSpec,
  ConditionStatus,
  EvaluatedItem,
  ExpiryReminderStatus,
  FinalItemStatus,
  ItemExpiryState,
  ItemStatus,
  Observation,
  OverallStatus,
  Priority,
} from './types.ts';

export const DEFAULT_EXPIRY_WARNING_DAYS = 60;

/** Parse 'YYYY-MM-DD' as a UTC calendar date (no timezone drift). */
function parseDateUTC(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  // reject impossible dates like 2026-02-31
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return t;
}

/** Whole days from `now` until `iso` (negative = already in the past). */
export function daysUntil(iso: string, now: Date): number | null {
  const target = parseDateUTC(iso);
  if (target === null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((target - today) / 86_400_000);
}

export function getExpiryReminderStatus(
  hasExpiry: boolean,
  expiryDate: string | null | undefined,
  warningDays: number | null | undefined,
  storedStatus: string | null | undefined,
  now: Date,
): ExpiryReminderStatus | null {
  if (!hasExpiry) return null;
  if (storedStatus === 'Expiry label mismatch') return 'Expiry label mismatch';
  if (!expiryDate) return 'No expiry date recorded';
  const days = daysUntil(expiryDate, now);
  if (days === null) return 'No expiry date recorded';
  if (days < 0) return 'Expired';
  if (days <= (warningDays ?? DEFAULT_EXPIRY_WARNING_DAYS)) return 'Expiring soon';
  return 'Valid';
}

export function getEffectiveExpiryDate(spec: BoxItemSpec, obs: Observation): string | null {
  if (!spec.has_expiry) return null;
  switch (obs.expiry_validation_status) {
    case 'different_date':
    case 'replaced_now':
      return obs.expiry_date ?? null;
    case 'matches_label':
    case 'no_label':
    case 'expired':
    case 'missing_not_replaced':
      return spec.current_expiry_date ?? null;
    default:
      return obs.expiry_date ?? spec.current_expiry_date ?? null;
  }
}

/**
 * Whether free-text remarks are mandatory for this observation. Per spec:
 * required for missing / damaged / empty stock, a missing-not-replaced item,
 * no expiry label, an expired item, a real expiry-date correction, or a
 * replacement. NOT required for a clean OK item, low stock, or a first-time
 * baseline expiry record.
 */
export function remarksRequired(spec: BoxItemSpec, obs: Observation, now: Date): boolean {
  if (obs.observed_present_status === 'Missing' || obs.observed_present_status === 'Damaged') return true;
  if (obs.observed_volume_level === 'Empty') return true;
  if (spec.measurement_type === 'quantity' && obs.observed_quantity != null && obs.observed_quantity <= 0) {
    return true;
  }
  const status = obs.expiry_validation_status ?? null;
  if (status === 'no_label' || status === 'missing_not_replaced' || status === 'replaced_now') return true;
  // Correcting an EXISTING saved date needs a note; a first baseline record does not.
  if (status === 'different_date' && spec.current_expiry_date != null) return true;
  if (spec.has_expiry) {
    const eff = getEffectiveExpiryDate(spec, obs);
    if (eff) {
      const d = daysUntil(eff, now);
      if (d !== null && d < 0) return true; // resolves to an expired item
    }
  }
  return false;
}

/**
 * Validate a single observation against its spec BEFORE scoring.
 * Returns a human-readable error string, or null when valid.
 * (The DB CHECK constraints are the final backstop; this gives clean 400s.)
 */
export function validateObservation(spec: BoxItemSpec, obs: Observation): string | null {
  switch (spec.measurement_type) {
    case 'quantity':
      if (obs.observed_quantity === null || obs.observed_quantity === undefined) {
        return `"${spec.item_name}": observed quantity is required.`;
      }
      if (!Number.isFinite(obs.observed_quantity) || obs.observed_quantity < 0) {
        return `"${spec.item_name}": observed quantity must be a number >= 0.`;
      }
      break;
    case 'volume_level':
      if (!obs.observed_volume_level) {
        return `"${spec.item_name}": volume level is required.`;
      }
      break;
    case 'present_absent':
      if (!obs.observed_present_status) {
        return `"${spec.item_name}": present/absent status is required.`;
      }
      break;
  }

  if (spec.has_expiry) {
    const status = obs.expiry_validation_status ?? null;
    if (!status) {
      // No explicit expiry choice. Legacy path: a raw expiry_date is still accepted.
      if (!obs.expiry_date) {
        return `"${spec.item_name}": an expiry check is required.`;
      }
      if (daysUntil(obs.expiry_date, new Date()) === null) {
        return `"${spec.item_name}": expiry date must be a valid YYYY-MM-DD date.`;
      }
    } else {
      if (status === 'matches_label' && !spec.current_expiry_date) {
        return `"${spec.item_name}": no saved expiry date to match - choose Record expiry date or I replaced this item now.`;
      }
      if (status === 'different_date' || status === 'replaced_now') {
        if (!obs.expiry_date) return `"${spec.item_name}": an expiry date is required.`;
        if (daysUntil(obs.expiry_date, new Date()) === null) {
          return `"${spec.item_name}": expiry date must be a valid YYYY-MM-DD date.`;
        }
      }
      if (status === 'replaced_now') {
        if (!obs.replacement_date) return `"${spec.item_name}": replacement date is required.`;
        if (daysUntil(obs.replacement_date, new Date()) === null) {
          return `"${spec.item_name}": replacement date must be a valid YYYY-MM-DD date.`;
        }
      }
    }
  }

  if (remarksRequired(spec, obs, new Date()) && !obs.remarks?.trim()) {
    return `"${spec.item_name}": remarks are required for this item.`;
  }
  return null;
}

/**
 * Score one item. Pure; `now` is injected so tests are deterministic.
 * Assumes validateObservation already passed (tolerant of nulls regardless).
 */
export function evaluateItem(spec: BoxItemSpec, obs: Observation, now: Date): EvaluatedItem {
  let missing = false;
  let damaged = false;
  let lowStock = false;
  let belowHalf = false;
  const expiryStatus = obs.expiry_validation_status ?? null;

  const observedQuantity = obs.observed_quantity ?? null;
  const observedVolume = obs.observed_volume_level ?? null;
  const observedPresent = obs.observed_present_status ?? null;

  // Layer A: condition (what the physical stock looks like).
  let condition_status: ConditionStatus = 'pending';

  switch (spec.measurement_type) {
    case 'quantity': {
      const required = spec.required_quantity ?? 0;
      if (observedQuantity === null) {
        condition_status = 'pending';
      } else if (observedQuantity <= 0) {
        missing = true;
        condition_status = 'missing';
      } else if (required > 0 && observedQuantity <= required * 0.5) {
        // "Low stock at 50% or below"
        lowStock = true;
        belowHalf = true;
        condition_status = 'half';
      } else {
        condition_status = 'full';
      }
      // Optional secondary trigger: explicit fixed-quantity restock threshold.
      if (
        spec.restock_threshold_type === 'fixed_quantity' &&
        spec.restock_threshold_quantity != null &&
        observedQuantity != null &&
        observedQuantity > 0 &&
        observedQuantity <= spec.restock_threshold_quantity
      ) {
        lowStock = true;
        if (condition_status === 'full') condition_status = 'half';
      }
      break;
    }
    case 'volume_level': {
      switch (observedVolume) {
        case 'Full':
        case 'Three Quarter':
          condition_status = 'full';
          break;
        case 'Half':
        case 'Below Half':
          lowStock = true;
          belowHalf = true;
          condition_status = 'half';
          break;
        case 'Empty':
          missing = true;
          belowHalf = true;
          condition_status = 'empty';
          break;
        default:
          condition_status = 'pending'; // no reading yet
      }
      break;
    }
    case 'present_absent': {
      switch (observedPresent) {
        case 'Present':
          condition_status = 'available';
          break;
        case 'Missing':
          missing = true;
          condition_status = 'missing';
          break;
        case 'Damaged':
          damaged = true;
          condition_status = 'damaged';
          break;
        default:
          condition_status = 'pending';
      }
      break;
    }
  }

  if (expiryStatus === 'missing_not_replaced') {
    missing = true;
    if (condition_status === 'pending' || condition_status === 'full' || condition_status === 'available') {
      condition_status = 'missing';
    }
  }

  // Layer B: expiry.
  let isExpired = false;
  let expiresSoon = false;
  const effectiveExpiryDate = getEffectiveExpiryDate(spec, obs);
  const noExpiryDateRecorded = Boolean(spec.has_expiry && !effectiveExpiryDate);
  // A real mismatch is a CORRECTION to an existing saved date, or a missing
  // label. A first-time baseline record (no prior saved date) is not a mismatch.
  const expiryLabelMismatch =
    (expiryStatus === 'different_date' && spec.current_expiry_date != null) ||
    expiryStatus === 'no_label';
  if (expiryStatus === 'expired') {
    isExpired = true;
  } else if (spec.has_expiry && effectiveExpiryDate) {
    const d = daysUntil(effectiveExpiryDate, now);
    if (d !== null) {
      if (d < 0) {
        isExpired = true;
      } else if (d <= (spec.expiry_warning_days ?? DEFAULT_EXPIRY_WARNING_DAYS)) {
        expiresSoon = true;
      }
    }
  }

  const expiryVerified = !spec.has_expiry || expiryStatus !== null;
  let expiry_state: ItemExpiryState;
  if (!spec.has_expiry) expiry_state = 'not_required';
  else if (expiryStatus === null) expiry_state = 'pending_verification';
  else if (expiryStatus === 'no_label') expiry_state = 'no_label';
  else if (noExpiryDateRecorded) expiry_state = 'not_recorded';
  else if (isExpired) expiry_state = 'expired';
  else if (expiresSoon) expiry_state = 'expiring_soon';
  else expiry_state = 'valid';

  // Stored single status label, most-severe-wins (unchanged vocabulary).
  let item_status: ItemStatus;
  if (isExpired) item_status = 'Expired';
  else if (expiryStatus === 'no_label') item_status = 'Expiry Label Mismatch';
  else if (noExpiryDateRecorded) item_status = 'No Expiry Date';
  else if (missing) item_status = 'Missing';
  else if (damaged) item_status = 'Damaged';
  else if (expiresSoon) item_status = 'Expiring Soon';
  else if (lowStock) item_status = 'Low Stock';
  else item_status = 'OK';

  const topup_required =
    isExpired ||
    expiresSoon ||
    missing ||
    damaged ||
    lowStock ||
    belowHalf ||
    expiryStatus === 'no_label' ||
    noExpiryDateRecorded;

  // Layer C: the single badge-facing verdict. An expiry-tracked item is never
  // "ok" until the inspector has explicitly verified expiry (the false-OK fix).
  let final_item_status: FinalItemStatus;
  if (condition_status === 'pending') final_item_status = 'pending';
  else if (spec.has_expiry && !expiryVerified) final_item_status = 'incomplete';
  else if (isExpired) final_item_status = 'replacement_required';
  else if (missing || damaged || expiryStatus === 'no_label' || expiryStatus === 'missing_not_replaced')
    final_item_status = 'issue_found';
  else if (lowStock || belowHalf || expiresSoon) final_item_status = 'topup_required';
  else final_item_status = 'ok';

  let priority: Priority = 'Low';
  if (
    isExpired ||
    missing ||
    damaged ||
    expiryStatus === 'no_label' ||
    noExpiryDateRecorded ||
    (spec.is_critical && topup_required)
  )
    priority = 'High';
  else if (expiresSoon || lowStock || belowHalf) priority = 'Medium';

  return {
    box_item_id: spec.box_item_id,
    item_name: spec.item_name,
    measurement_type: spec.measurement_type,
    required_quantity: spec.required_quantity,
    observed_quantity: observedQuantity,
    observed_volume_level: observedVolume,
    observed_present_status: observedPresent,
    expiry_date: effectiveExpiryDate,
    system_expiry_date: spec.current_expiry_date ?? null,
    expiry_validation_status: expiryStatus,
    expiry_label_mismatch: expiryLabelMismatch,
    no_expiry_date_recorded: noExpiryDateRecorded,
    item_status,
    condition_status,
    expiry_state,
    expiry_verified: expiryVerified,
    final_item_status,
    is_below_half: belowHalf,
    is_expired: isExpired,
    expires_soon: expiresSoon,
    topup_required,
    is_critical: spec.is_critical,
    reason: buildReason(item_status, spec, observedQuantity, observedVolume),
    priority,
  };
}

function buildReason(
  status: ItemStatus,
  spec: BoxItemSpec,
  qty: number | null,
  volume: string | null,
): string {
  switch (status) {
    case 'Expired':
      return 'Item is expired and must be replaced.';
    case 'Expiring Soon':
      return 'Item is expiring soon.';
    case 'No Expiry Date':
      return 'No expiry date is recorded for this box item.';
    case 'Expiry Label Mismatch':
      return 'Expiry label could not be verified.';
    case 'Missing':
      return spec.measurement_type === 'quantity'
        ? 'Item is out of stock (quantity 0).'
        : spec.measurement_type === 'volume_level'
          ? 'Container is empty.'
          : 'Item is missing.';
    case 'Damaged':
      return 'Item is damaged.';
    case 'Low Stock':
      if (spec.measurement_type === 'volume_level') return `Volume is ${volume} (at or below half).`;
      return `Low stock: ${qty ?? 0} of ${spec.required_quantity ?? '?'} remaining.`;
    default:
      return 'Restock recommended.';
  }
}

/**
 * Overall inspection verdict from the evaluated lines + whether a live box
 * photo was supplied.
 *   Fail        - box not fit for emergency use (expired item, critical item
 *                 missing/damaged, or no box photo).
 *   Needs Restock - usable but something needs attention.
 *   Pass        - everything OK.
 */
export function computeOverallStatus(items: EvaluatedItem[], hasBoxPhoto: boolean): OverallStatus {
  let fail = false;
  let needsRestock = false;

  if (!hasBoxPhoto) fail = true;

  for (const it of items) {
    if (it.is_expired) fail = true; // expired medical item -> unsafe
    if (it.item_status === 'Missing' && it.is_critical) fail = true;
    if (it.item_status === 'Damaged' && it.is_critical) fail = true;
    if (it.topup_required) needsRestock = true;
  }

  if (fail) return 'Fail';
  if (needsRestock) return 'Needs Restock';
  return 'Pass';
}

/** Roll-up counters for the API response + reporting. */
export function summarize(items: EvaluatedItem[]) {
  return {
    total: items.length,
    ok: items.filter((i) => i.item_status === 'OK').length,
    low_stock: items.filter((i) => i.item_status === 'Low Stock').length,
    missing: items.filter((i) => i.item_status === 'Missing').length,
    damaged: items.filter((i) => i.item_status === 'Damaged').length,
    expired: items.filter((i) => i.is_expired).length,
    expiring_soon: items.filter((i) => i.expires_soon).length,
    no_expiry_date_recorded: items.filter((i) => i.no_expiry_date_recorded).length,
    expiry_label_mismatch: items.filter((i) => i.expiry_label_mismatch).length,
    topup_required: items.filter((i) => i.topup_required).length,
  };
}
