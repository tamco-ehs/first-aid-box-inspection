import type { createAdminClient } from '@/lib/supabase/admin';

type Admin = ReturnType<typeof createAdminClient>;

interface ExpiredItemRow {
  id: string;
  box_id: string;
  item_name: string;
  required_quantity: number | null;
  current_quantity: number | null;
  expiry_date: string | null;
}

export async function ensureExpiredItemActions(admin: Admin): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: expiredRows, error: expiredErr } = await admin
    .from('box_items')
    .select('id, box_id, item_name, required_quantity, current_quantity, expiry_date')
    .eq('is_active', true)
    .eq('has_expiry', true)
    .lt('expiry_date', today)
    .limit(1000);

  if (expiredErr) {
    console.error('[expired-actions] expired item lookup failed:', expiredErr.message);
    return;
  }

  const expired = (expiredRows ?? []) as ExpiredItemRow[];
  if (expired.length === 0) return;

  const boxIds = [...new Set(expired.map((item) => item.box_id))];
  const { data: activeBoxes, error: boxErr } = await admin
    .from('boxes')
    .select('id')
    .eq('is_active', true)
    .in('id', boxIds);

  if (boxErr) {
    console.error('[expired-actions] active box lookup failed:', boxErr.message);
    return;
  }

  const activeBoxIds = new Set(((activeBoxes ?? []) as { id: string }[]).map((box) => box.id));
  const activeExpired = expired.filter((item) => activeBoxIds.has(item.box_id));
  if (activeExpired.length === 0) return;

  const itemIds = activeExpired.map((item) => item.id);
  const { data: existingActions, error: existingErr } = await admin
    .from('actions')
    .select('box_item_id')
    .eq('category', 'item')
    .eq('action_type', 'Item Expired')
    .in('status', ['Open', 'In Progress'])
    .in('box_item_id', itemIds);

  if (existingErr) {
    console.error('[expired-actions] existing action lookup failed:', existingErr.message);
    return;
  }

  const existingItemIds = new Set(
    ((existingActions ?? []) as { box_item_id: string | null }[])
      .map((action) => action.box_item_id)
      .filter((id): id is string => Boolean(id)),
  );

  const missing = activeExpired.filter((item) => !existingItemIds.has(item.id));
  if (missing.length === 0) return;

  const { error: insertErr } = await admin.from('actions').insert(
    missing.map((item) => ({
      box_id: item.box_id,
      action_type: 'Item Expired',
      category: 'item',
      box_item_id: item.id,
      item_name: item.item_name,
      required_quantity: item.required_quantity,
      observed_quantity: item.current_quantity,
      expiry_date: item.expiry_date,
      new_expiry_date: null,
      priority: 'High',
      details: null,
      created_by: null,
    })),
  );

  if (insertErr) {
    console.error('[expired-actions] action insert failed:', insertErr.message);
  }
}
