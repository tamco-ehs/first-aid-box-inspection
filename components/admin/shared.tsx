'use client';

import { useEffect, useState, type ReactNode } from 'react';

// Shared bits for the admin sections. All data access uses the Supabase browser
// client; the Phase 1 admin RLS policies are what authorize these reads/writes.

export interface AdminBox {
  id: string;
  box_code: string;
  box_name: string;
  location_description: string;
  area: string | null;
  template_id: string | null;
  inspection_frequency_days: number;
  is_active: boolean;
}

export interface AdminProfile {
  id: string;
  full_name: string;
  employee_id: string | null;
  department: string | null;
  email: string | null;
  role: 'admin' | 'first_aider' | 'viewer';
  is_active: boolean;
}

export interface TemplateRow {
  id: string;
  template_name: string;
  is_active: boolean;
}

export interface TemplateItemRow {
  id: string;
  template_id: string;
  item_code: string | null;
  item_name: string;
  required_quantity: number | null;
  unit: string | null;
  measurement_type: 'quantity' | 'volume_level' | 'present_absent';
  has_expiry: boolean;
  expiry_warning_days: number;
  is_critical: boolean;
  item_photo_url: string | null;
  display_order: number;
  is_active: boolean;
}

export interface BoxItemRow {
  id: string;
  box_id: string;
  item_name: string;
  required_quantity: number | null;
  unit: string | null;
  measurement_type: string;
  has_expiry: boolean;
  expiry_date: string | null;
  expiry_status: string | null;
  last_verified_date: string | null;
  last_replaced_date: string | null;
  item_photo_url: string | null;
  is_active: boolean;
}

export interface TopupRow {
  id: string;
  box_id: string;
  item_name: string;
  item_photo_url: string | null;
  reason: string | null;
  priority: 'Low' | 'Medium' | 'High' | null;
  status: 'Open' | 'In Progress' | 'Completed' | 'Rejected';
  requested_at: string;
  remarks: string | null;
}

export function useAsync<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setData(await loader());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: run };
}

export function Notice({ kind, children }: { kind: 'ok' | 'error'; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      className={`rounded-lg px-3 py-2 text-sm font-medium ${
        kind === 'ok' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
      }`}
    >
      {children}
    </p>
  );
}

export function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="card p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

export const APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
