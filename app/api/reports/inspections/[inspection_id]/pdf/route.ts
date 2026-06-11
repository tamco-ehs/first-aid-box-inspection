import { createHash } from 'node:crypto';
import { requireActive, requireRole } from '@/lib/auth';
import { badRequest, notFound, safe } from '@/lib/http';
import { createAdminClient } from '@/lib/supabase/admin';
import { SimplePdf } from '@/lib/pdf/simple.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type BoxSnapshot = {
  box_code: string;
  box_name: string;
  location_description: string | null;
  area: string | null;
};

type InspectionRow = {
  id: string;
  box_id: string;
  inspector_id: string | null;
  inspector_name: string;
  inspector_department: string | null;
  created_at: string;
  overall_status: string;
  box_photo_url: string | null;
  notes: string | null;
  submitted_device: string | null;
  submitted_user_agent: string | null;
  boxes: BoxSnapshot | BoxSnapshot[] | null;
};

type InspectionItemRow = {
  id: string;
  item_name: string;
  required_quantity: number | string | null;
  observed_quantity: number | string | null;
  unit: string | null;
  measurement_type: string | null;
  observed_volume_level: string | null;
  observed_present_status: string | null;
  expiry_date: string | null;
  system_expiry_date: string | null;
  expiry_validation_status: string | null;
  expiry_label_mismatch: boolean;
  no_expiry_date_recorded: boolean;
  item_status: string | null;
  is_expired: boolean;
  expires_soon: boolean;
  topup_required: boolean;
  remarks: string | null;
};

type TopupRow = {
  item_name: string;
  reason: string | null;
  priority: string | null;
  status: string;
  requested_at: string;
  completed_at: string | null;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ inspection_id: string }> },
): Promise<Response> {
  return safe(async () => {
    const ctx = await requireActive();
    requireRole(ctx, ['admin', 'viewer']);

    const { inspection_id } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(inspection_id)) {
      throw badRequest('Invalid inspection id.');
    }

    const admin = createAdminClient();

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .select(
        [
          'id',
          'box_id',
          'inspector_id',
          'inspector_name',
          'inspector_department',
          'created_at',
          'overall_status',
          'box_photo_url',
          'notes',
          'submitted_device',
          'submitted_user_agent',
          'boxes(box_code, box_name, location_description, area)',
        ].join(', '),
      )
      .eq('id', inspection_id)
      .maybeSingle();

    if (inspectionError) throw new Error(inspectionError.message);
    if (!inspection) throw notFound('Inspection was not found.');

    const { data: items, error: itemsError } = await admin
      .from('inspection_items')
      .select(
        [
          'id',
          'item_name',
          'required_quantity',
          'observed_quantity',
          'unit',
          'measurement_type',
          'observed_volume_level',
          'observed_present_status',
          'expiry_date',
          'system_expiry_date',
          'expiry_validation_status',
          'expiry_label_mismatch',
          'no_expiry_date_recorded',
          'item_status',
          'is_expired',
          'expires_soon',
          'topup_required',
          'remarks',
        ].join(', '),
      )
      .eq('inspection_id', inspection_id)
      .order('item_name', { ascending: true });

    if (itemsError) throw new Error(itemsError.message);

    const { data: topups, error: topupsError } = await admin
      .from('topup_requests')
      .select('item_name, reason, priority, status, requested_at, completed_at')
      .eq('inspection_id', inspection_id)
      .order('requested_at', { ascending: true });

    if (topupsError) throw new Error(topupsError.message);

    const row = inspection as unknown as InspectionRow;
    const box = normalizeBox(row.boxes);
    const itemRows = (items ?? []) as unknown as InspectionItemRow[];
    const topupRows = (topups ?? []) as unknown as TopupRow[];
    const generatedAt = new Date();
    const integrityHash = createAuditHash(row, itemRows, topupRows);
    const pdf = buildInspectionPdf({
      inspection: row,
      box,
      items: itemRows,
      topups: topupRows,
      generatedAt,
      generatedBy: `${ctx.profile.full_name}${ctx.email ? ` <${ctx.email}>` : ''}`,
      integrityHash,
    });

    const filename = [
      safeFilename(box?.box_code ?? 'inspection'),
      'inspection',
      safeFilename(formatDateForFilename(row.created_at)),
      row.id.slice(0, 8),
    ].join('-');

    const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  });
}

function buildInspectionPdf({
  inspection,
  box,
  items,
  topups,
  generatedAt,
  generatedBy,
  integrityHash,
}: {
  inspection: InspectionRow;
  box: BoxSnapshot | null;
  items: InspectionItemRow[];
  topups: TopupRow[];
  generatedAt: Date;
  generatedBy: string;
  integrityHash: string;
}): Uint8Array {
  const title = `${box?.box_code ?? 'Box'} inspection audit`;
  const pdf = new SimplePdf(title);

  pdf.heading('First Aid Box Inspection Audit Report', 17);
  pdf.paragraph(
    'Read-only audit copy generated from the saved system inspection record. Keep this PDF with auditor evidence.',
    { size: 9 },
  );
  pdf.rule();

  pdf.heading('Audit Metadata', 12);
  pdf.keyValue('Report generated at', `${formatAuditDateTime(generatedAt)} / ${generatedAt.toISOString()}`);
  pdf.keyValue('Generated by', generatedBy);
  pdf.keyValue('Inspection record ID', inspection.id);
  pdf.keyValue('Integrity fingerprint', integrityHash);
  pdf.keyValue('Source system', 'First Aid Box Inspection System');
  pdf.keyValue('Record status', 'Append-only inspection record');
  pdf.spacer(4);

  pdf.heading('Inspection Summary', 12);
  pdf.keyValue('Inspection date/time', `${formatAuditDateTime(inspection.created_at)} / ${new Date(inspection.created_at).toISOString()}`);
  pdf.keyValue('Overall status', inspection.overall_status);
  pdf.keyValue('Inspector', inspection.inspector_name);
  pdf.keyValue('Department', inspection.inspector_department ?? '-');
  pdf.keyValue('Submitted device', inspection.submitted_device ?? '-');
  pdf.keyValue('User agent', inspection.submitted_user_agent ?? '-');
  pdf.spacer(4);

  pdf.heading('Box Details', 12);
  pdf.keyValue('Box code', box?.box_code ?? '-');
  pdf.keyValue('Box name', box?.box_name ?? '-');
  pdf.keyValue('Area', box?.area ?? '-');
  pdf.keyValue('Location', box?.location_description ?? '-');
  pdf.keyValue('Live box photo URL', inspection.box_photo_url ?? '-');
  pdf.keyValue('Notes', inspection.notes ?? '-');
  pdf.rule();

  pdf.heading('Checklist Results', 12);
  pdf.tableHeader(['Item', 'Required', 'Observed', 'Expiry', 'Status', 'Remarks'], [128, 55, 72, 76, 78, 102]);
  for (const item of items) {
    pdf.tableRow(
      [
        item.item_name,
        quantityText(item.required_quantity, item.unit),
        observedText(item),
        expiryText(item),
        statusText(item),
        item.remarks ?? '-',
      ],
      [128, 55, 72, 76, 78, 102],
      26,
    );
  }

  pdf.spacer(8);
  pdf.heading('Top-up / Corrective Actions', 12);
  if (topups.length === 0) {
    pdf.paragraph('No top-up requests were created from this inspection.', { size: 9 });
  } else {
    pdf.tableHeader(['Item', 'Priority', 'Status', 'Requested', 'Completed', 'Reason'], [120, 52, 62, 78, 78, 120]);
    for (const topup of topups) {
      pdf.tableRow(
        [
          topup.item_name,
          topup.priority ?? '-',
          topup.status,
          formatAuditDate(topup.requested_at),
          formatAuditDate(topup.completed_at),
          topup.reason ?? '-',
        ],
        [120, 52, 62, 78, 78, 120],
        24,
      );
    }
  }

  pdf.spacer(10);
  pdf.rule();
  pdf.paragraph(
    'Audit note: this PDF records the inspection values stored at submission time. The integrity fingerprint is generated from the inspection header, checklist rows, and corrective action rows included in this export.',
    { size: 8 },
  );

  return pdf.toBytes();
}

function normalizeBox(value: InspectionRow['boxes']): BoxSnapshot | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function observedText(item: InspectionItemRow): string {
  if (item.observed_quantity !== null && item.observed_quantity !== undefined) return quantityText(item.observed_quantity, item.unit);
  return item.observed_volume_level ?? item.observed_present_status ?? '-';
}

function quantityText(value: number | string | null, unit: string | null): string {
  if (value === null || value === undefined || value === '') return '-';
  return `${value}${unit ? ` ${unit}` : ''}`;
}

function expiryText(item: InspectionItemRow): string {
  const date = item.expiry_date ?? item.system_expiry_date;
  const flags = [
    item.expiry_validation_status,
    item.expiry_label_mismatch ? 'label mismatch' : null,
    item.no_expiry_date_recorded ? 'no date recorded' : null,
  ].filter(Boolean);
  return `${date ?? '-'}${flags.length > 0 ? ` (${flags.join(', ')})` : ''}`;
}

function statusText(item: InspectionItemRow): string {
  const flags = [
    item.item_status ?? '-',
    item.topup_required ? 'top-up required' : null,
    item.is_expired ? 'expired' : null,
    item.expires_soon ? 'expiring soon' : null,
  ].filter(Boolean);
  return flags.join(', ');
}

function createAuditHash(inspection: InspectionRow, items: InspectionItemRow[], topups: TopupRow[]): string {
  const payload = JSON.stringify({
    inspection: {
      id: inspection.id,
      box_id: inspection.box_id,
      inspector_id: inspection.inspector_id,
      inspector_name: inspection.inspector_name,
      created_at: inspection.created_at,
      overall_status: inspection.overall_status,
      notes: inspection.notes,
    },
    items,
    topups,
  });
  return createHash('sha256').update(payload).digest('hex');
}

function formatAuditDateTime(value: string | Date | null): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d) + ' MYT';
}

function formatAuditDate(value: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kuala_Lumpur',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

function formatDateForFilename(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'unknown-date';
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'inspection';
}
