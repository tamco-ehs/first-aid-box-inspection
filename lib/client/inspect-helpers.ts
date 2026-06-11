// Helpers shared by the inspection page and the ChecklistCard so the live,
// on-screen status preview uses the EXACT same scoring (lib/logic/inspection)
// as the server. (The server still recomputes authoritatively on submit.)

import type { DraftObservation } from './draft.ts';
import type { TemplateItem } from './types.ts';
import type { BoxItemSpec } from '@/lib/logic/types.ts';

export function toSpec(item: TemplateItem): BoxItemSpec {
  return {
    box_item_id: item.box_item_id,
    item_name: item.item_name,
    measurement_type: item.measurement_type,
    required_quantity: item.required_quantity,
    has_expiry: item.has_expiry,
    current_expiry_date: item.current_expiry_date,
    expiry_warning_days: item.expiry_warning_days,
    is_critical: item.is_critical,
    // restock thresholds are server-side only; preview omits them
    restock_threshold_type: null,
    restock_threshold_quantity: null,
  };
}

/** Has the inspector entered the measurement value for this item yet? */
export function hasObservation(item: TemplateItem, obs: DraftObservation | undefined): boolean {
  if (!obs) return false;
  if (item.measurement_type === 'quantity') {
    return obs.observed_quantity !== null && obs.observed_quantity !== undefined;
  }
  if (item.measurement_type === 'volume_level') return Boolean(obs.observed_volume_level);
  return Boolean(obs.observed_present_status);
}
