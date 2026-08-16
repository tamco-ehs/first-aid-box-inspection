// =============================================================================
// Auto-close ESH actions whose underlying problem is already fixed.
//
// Why this exists: actions were only ever CREATED. Nothing closed them except
// the ESH "Close Action" screen, so a box stayed "Issue Found" forever even
// after the stock was topped up in Admin, the expiry date revised, or a clean
// inspection submitted. This runs the pure rules in lib/logic/resolve.ts against
// the current box state and closes whatever is genuinely resolved.
//
// SERVER ONLY (uses the service-role client). Cheap: it exits immediately when
// a box has no open actions, and only writes when something actually resolved.
// =============================================================================

import type { createAdminClient } from '@/lib/supabase/admin';
import {
  isActionResolved,
  itemLookupKey,
  type ItemState,
  type LatestInspection,
  type ResolvableAction,
} from '@/lib/logic/resolve.ts';

type Admin = ReturnType<typeof createAdminClient>;

const AUTO_NOTE = 'Auto-closed by the system: the reported problem is no longer present.';

/**
 * Close every open action for these boxes whose condition is now resolved.
 * Returns how many were closed. Never throws - a failure here must not break
 * the caller (it only means a stale badge until the next run).
 */
export async function resolveBoxActions(admin: Admin, boxIds: string[]): Promise<number> {
  const ids = [...new Set(boxIds.filter(Boolean))];
  if (ids.length === 0) return 0;

  try {
    // 1. Open actions for these boxes.
    const { data: actionData, error: actionErr } = await admin
      .from('actions')
      .select('id, box_id, action_type, category, box_item_id, item_name, created_at')
      .in('box_id', ids)
      .in('status', ['Open', 'In Progress']);
    if (actionErr) {
      console.error('[resolve-actions] could not read actions:', actionErr.message);
      return 0;
    }
    const actions = (actionData ?? []) as unknown as (ResolvableAction & { box_id: string })[];
    if (actions.length === 0) return 0;

    const boxesWithActions = [...new Set(actions.map((a) => a.box_id))];

    // 2. Current item state + 3. latest inspection per box.
    const [{ data: itemData }, { data: inspData }] = await Promise.all([
      admin
        .from('box_items')
        .select('id, box_id, item_name, required_quantity, current_quantity, has_expiry, expiry_date, is_active')
        .in('box_id', boxesWithActions),
      admin
        .from('inspections')
        .select('box_id, created_at, box_accessible, box_clean, contact_visible')
        .in('box_id', boxesWithActions)
        .order('created_at', { ascending: false }),
    ]);

    const itemById = new Map<string, ItemState>();
    const itemByName = new Map<string, ItemState>();
    for (const raw of (itemData ?? []) as unknown as (ItemState & { box_id: string })[]) {
      const state: ItemState = {
        id: raw.id,
        item_name: raw.item_name,
        required_quantity: raw.required_quantity,
        current_quantity: raw.current_quantity,
        has_expiry: raw.has_expiry,
        expiry_date: raw.expiry_date,
        is_active: raw.is_active,
      };
      itemById.set(raw.id, state);
      itemByName.set(itemLookupKey(raw.box_id, raw.item_name), state);
    }

    const latestByBox = new Map<string, LatestInspection>();
    for (const row of (inspData ?? []) as unknown as (LatestInspection & { box_id: string })[]) {
      if (!latestByBox.has(row.box_id)) {
        latestByBox.set(row.box_id, {
          created_at: row.created_at,
          box_accessible: row.box_accessible,
          box_clean: row.box_clean,
          contact_visible: row.contact_visible,
        });
      }
    }

    // 4. Decide.
    const today = new Date().toISOString().slice(0, 10);
    const resolvedIds = actions
      .filter((a) => {
        const item =
          (a.box_item_id ? itemById.get(a.box_item_id) : undefined) ??
          (a.item_name ? itemByName.get(itemLookupKey(a.box_id, a.item_name)) : undefined);
        return isActionResolved(a, item, latestByBox.get(a.box_id) ?? null, today);
      })
      .map((a) => a.id);

    if (resolvedIds.length === 0) return 0;

    // 5. Close them.
    const { error: closeErr } = await admin
      .from('actions')
      .update({ status: 'Closed', closed_at: new Date().toISOString(), closure_note: AUTO_NOTE })
      .in('id', resolvedIds);
    if (closeErr) {
      console.error('[resolve-actions] could not close actions:', closeErr.message);
      return 0;
    }
    return resolvedIds.length;
  } catch (err) {
    console.error('[resolve-actions] unexpected failure:', err);
    return 0;
  }
}

/** Same, for every box that currently has an open action (dashboard / lists). */
export async function resolveAllOpenActions(admin: Admin): Promise<number> {
  try {
    const { data, error } = await admin
      .from('actions')
      .select('box_id')
      .in('status', ['Open', 'In Progress']);
    if (error) {
      console.error('[resolve-actions] could not scan open actions:', error.message);
      return 0;
    }
    const ids = [...new Set(((data ?? []) as unknown as { box_id: string }[]).map((r) => r.box_id))];
    return resolveBoxActions(admin, ids);
  } catch (err) {
    console.error('[resolve-actions] unexpected failure:', err);
    return 0;
  }
}
