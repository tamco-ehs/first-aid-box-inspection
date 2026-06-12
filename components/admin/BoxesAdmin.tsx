'use client';

import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase/client';
import { Spinner } from '@/components/Spinner';
import { Badge } from '@/components/StatusBadge';
import { APP_URL, Notice, Section, useAsync, type AdminBox, type TemplateRow } from './shared.tsx';

export function BoxesAdmin() {
  const sb = getSupabaseBrowserClient();
  const boxes = useAsync<AdminBox[]>(async () => {
    const { data, error } = await sb
      .from('boxes')
      .select('id, box_code, box_name, location_description, area, template_id, inspection_frequency_days, is_active')
      .order('box_code');
    if (error) throw new Error(error.message);
    return (data ?? []) as unknown as AdminBox[];
  });
  const templates = useAsync<TemplateRow[]>(async () => {
    const { data } = await sb.from('first_aid_kit_templates').select('id, template_name, is_active').order('template_name');
    return (data ?? []) as unknown as TemplateRow[];
  });

  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  if (boxes.loading) return <Centered />;
  return (
    <div className="space-y-4">
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
      {boxes.error && <Notice kind="error">{boxes.error}</Notice>}

      <NewBoxForm
        templates={templates.data ?? []}
        onCreated={() => {
          setMsg({ kind: 'ok', text: 'Box created and checklist items added.' });
          boxes.reload();
        }}
        onError={(t) => setMsg({ kind: 'error', text: t })}
      />

      {(boxes.data ?? []).map((box) => (
        <BoxRow
          key={box.id}
          box={box}
          templates={templates.data ?? []}
          onSaved={() => {
            setMsg({ kind: 'ok', text: `Saved ${box.box_code}.` });
            boxes.reload();
          }}
          onError={(t) => setMsg({ kind: 'error', text: t })}
        />
      ))}
    </div>
  );
}

function NewBoxForm({
  templates,
  onCreated,
  onError,
}: {
  templates: TemplateRow[];
  onCreated: () => void;
  onError: (t: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    box_code: '',
    box_name: '',
    location_description: '',
    area: '',
    template_id: templates[0]?.id ?? '',
    inspection_frequency_days: 30,
  });

  async function create() {
    setBusy(true);
    try {
      const { data, error } = await sb
        .from('boxes')
        .insert({
          box_code: f.box_code.trim(),
          box_name: f.box_name.trim(),
          location_description: f.location_description.trim(),
          area: f.area.trim() || null,
          template_id: f.template_id || null,
          inspection_frequency_days: Number(f.inspection_frequency_days) || 30,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      if (f.template_id && data) {
        await sb.rpc('apply_template_to_box', { p_box_id: (data as { id: string }).id });
      }
      setF({ box_code: '', box_name: '', location_description: '', area: '', template_id: templates[0]?.id ?? '', inspection_frequency_days: 30 });
      setOpen(false);
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not create box.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-md btn-primary">
        + New box
      </button>
    );
  }

  return (
    <Section title="New box">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Box code">
          <input className="input" value={f.box_code} onChange={(e) => setF({ ...f, box_code: e.target.value })} placeholder="FAB-WH-002" />
        </L>
        <L label="Box name">
          <input className="input" value={f.box_name} onChange={(e) => setF({ ...f, box_name: e.target.value })} />
        </L>
        <L label="Location">
          <input className="input" value={f.location_description} onChange={(e) => setF({ ...f, location_description: e.target.value })} />
        </L>
        <L label="Area">
          <input className="input" value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} />
        </L>
        <L label="Template">
          <select className="select" value={f.template_id} onChange={(e) => setF({ ...f, template_id: e.target.value })}>
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.template_name}
              </option>
            ))}
          </select>
        </L>
        <L label="Inspection frequency (days)">
          <input type="number" min={1} className="input" value={f.inspection_frequency_days} onChange={(e) => setF({ ...f, inspection_frequency_days: Number(e.target.value) })} />
        </L>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={create} disabled={busy || !f.box_code || !f.box_name || !f.location_description} className="btn btn-md btn-primary">
          {busy ? <Spinner className="h-4 w-4" /> : 'Create box'}
        </button>
        <button onClick={() => setOpen(false)} className="btn btn-md btn-secondary">
          Cancel
        </button>
      </div>
    </Section>
  );
}

function BoxRow({
  box,
  templates,
  onSaved,
  onError,
}: {
  box: AdminBox;
  templates: TemplateRow[];
  onSaved: () => void;
  onError: (t: string) => void;
}) {
  const sb = getSupabaseBrowserClient();
  const [f, setF] = useState(box);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const inspectUrl = `${APP_URL}/inspect/${box.id}`;
  const usageUrl = `${APP_URL}/usage?box=${box.id}&code=${encodeURIComponent(box.box_code)}`;

  async function save() {
    setBusy(true);
    try {
      const { error } = await sb
        .from('boxes')
        .update({
          box_name: f.box_name.trim(),
          location_description: f.location_description.trim(),
          area: f.area?.trim() || null,
          template_id: f.template_id || null,
          inspection_frequency_days: Number(f.inspection_frequency_days) || 30,
        })
        .eq('id', box.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    try {
      const { error } = await sb.from('boxes').update({ is_active: !box.is_active }).eq('id', box.id);
      if (error) throw new Error(error.message);
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not update.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      title={box.box_code}
      actions={<Badge tone={box.is_active ? 'ok' : 'neutral'}>{box.is_active ? 'Active' : 'Inactive'}</Badge>}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Box name">
          <input className="input" value={f.box_name} onChange={(e) => setF({ ...f, box_name: e.target.value })} />
        </L>
        <L label="Location">
          <input className="input" value={f.location_description} onChange={(e) => setF({ ...f, location_description: e.target.value })} />
        </L>
        <L label="Area">
          <input className="input" value={f.area ?? ''} onChange={(e) => setF({ ...f, area: e.target.value })} />
        </L>
        <L label="Template">
          <select className="select" value={f.template_id ?? ''} onChange={(e) => setF({ ...f, template_id: e.target.value || null })}>
            <option value="">None</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.template_name}
              </option>
            ))}
          </select>
        </L>
        <L label="Inspection frequency (days)">
          <input type="number" min={1} className="input" value={f.inspection_frequency_days} onChange={(e) => setF({ ...f, inspection_frequency_days: Number(e.target.value) })} />
        </L>
      </div>

      <div className="mt-3 space-y-1 rounded-lg bg-slate-50 p-3 text-xs">
        <UrlRow label="Inspection link" url={inspectUrl} />
        <UrlRow label="Usage QR link" url={usageUrl} />
        <button
          onClick={() => {
            navigator.clipboard?.writeText(`Inspect: ${inspectUrl}\nUsage: ${usageUrl}`);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="font-semibold text-brand"
        >
          {copied ? 'Copied!' : 'Copy both links'}
        </button>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <QrAssetCard
          title="Inspection QR"
          description="Print this for the monthly inspection record."
          href={qrAssetPath(box.box_code, 'inspection')}
        />
        <QrAssetCard
          title="Usage QR"
          description="Print this near the box for item withdrawals."
          href={qrAssetPath(box.box_code, 'usage')}
        />
      </div>

      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={busy} className="btn btn-md btn-primary">
          {busy ? <Spinner className="h-4 w-4" /> : 'Save'}
        </button>
        <button onClick={toggleActive} disabled={busy} className="btn btn-md btn-secondary">
          {box.is_active ? 'Deactivate' : 'Activate'}
        </button>
      </div>
    </Section>
  );
}

function QrAssetCard({
  title,
  description,
  href,
}: {
  title: string;
  description: string;
  href: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex gap-3">
        <a href={href} target="_blank" rel="noreferrer" className="block shrink-0" aria-label={`Open ${title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={href}
            alt=""
            loading="lazy"
            className="h-24 w-20 rounded-lg border border-slate-200 bg-slate-50 object-cover"
          />
        </a>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-slate-600">{description}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <a href={href} target="_blank" rel="noreferrer" className="btn btn-sm btn-secondary">
              Open
            </a>
            <a href={href} download className="btn btn-sm btn-primary">
              Download
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function UrlRow({ label, url }: { label: string; url: string }) {
  return (
    <div className="truncate">
      <span className="text-slate-500">{label}: </span>
      <span className="font-mono">{url}</span>
    </div>
  );
}

function qrAssetPath(boxCode: string, type: 'inspection' | 'usage') {
  return `/qr-codes/first-aid-boxes/${safeBoxCode(boxCode)}-${type}-qr.svg`;
}

function safeBoxCode(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Centered() {
  return (
    <div className="flex justify-center py-12 text-slate-400">
      <Spinner className="h-7 w-7" />
    </div>
  );
}
