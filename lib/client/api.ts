'use client';

// Typed fetch wrappers around the API routes. All requests are same-origin and
// send the session cookie automatically. Errors are normalized to
// ApiClientError carrying the server's clean { code, message }.

import type {
  ActionsResponse,
  InspectionTemplateResponse,
  ItemCheckStatus,
  Me,
  MyBoxesResponse,
  QuickInspectionResult,
  ReportsResponse,
  SignatureResponse,
  Role,
} from './types.ts';

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiClientError(0, 'network', 'Network error. Check your connection and try again.');
  }

  const text = await res.text();
  const data = text ? safeJson(text) : null;

  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiClientError(res.status, err?.code ?? 'error', err?.message ?? 'Request failed.');
  }
  return data as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface QuickInspectionBody {
  box_id: string;
  box_accessible: boolean;
  box_clean: boolean;
  seal_intact: boolean;
  contact_visible: boolean;
  notes?: string | null;
  box_photo_url?: string | null;
  box_photo_cloudinary_public_id?: string | null;
  submitted_device?: string | null;
  item_check?: Array<{
    box_item_id: string;
    status: ItemCheckStatus;
    observed_quantity?: number | null;
    new_expiry_date?: string | null;
    remark?: string | null;
  }>;
}

export interface UsageSubmitBody {
  box_id: string;
  user_name: string;
  department: string;
  usage_purpose: string;
  items_taken?: string[] | null;
  notes?: string | null;
  website?: string; // honeypot
}

export interface ActionCloseBody {
  action_id: string;
  closure_note?: string | null;
  items?: Array<{
    box_item_id: string;
    after_refill_quantity?: number | null;
    new_expiry_date?: string | null;
  }>;
}

export interface AdminUserBody {
  email: string;
  password: string;
  full_name: string;
  employee_id?: string | null;
  department?: string | null;
  role: Role;
  is_active: boolean;
}

export interface AdminUserUpdateBody {
  id: string;
  full_name?: string;
  employee_id?: string | null;
  department?: string | null;
  role?: Role;
  is_active?: boolean;
}

export interface EmailTestResponse {
  ok: boolean;
  recipient: string;
  count: number;
  sent: number;
  results: Array<{
    key: string;
    label: string;
    ok: boolean;
    id: string | null;
    error?: string;
  }>;
}

export const api = {
  me: () => request<Me>('/api/me'),
  myBoxes: () => request<MyBoxesResponse>('/api/my-boxes'),
  inspectionTemplate: (boxId: string) =>
    request<InspectionTemplateResponse>(`/api/boxes/${encodeURIComponent(boxId)}/inspection-template`),
  submitInspection: (body: QuickInspectionBody) =>
    request<QuickInspectionResult>('/api/inspections', { method: 'POST', body: JSON.stringify(body) }),
  submitUsage: (body: UsageSubmitBody) =>
    request<{ ok: boolean; message: string }>('/api/usage', { method: 'POST', body: JSON.stringify(body) }),
  reports: (query: string) => request<ReportsResponse>(`/api/reports${query ? `?${query}` : ''}`),
  adminUsers: () => request<{ users: Me[] }>('/api/admin/users'),
  createAdminUser: (body: AdminUserBody) =>
    request<{ ok: boolean; user: Me }>('/api/admin/users', { method: 'POST', body: JSON.stringify(body) }),
  updateAdminUser: (body: AdminUserUpdateBody) =>
    request<{ ok: boolean }>('/api/admin/users', { method: 'PATCH', body: JSON.stringify(body) }),
  deleteAdminUser: (id: string) =>
    request<{ ok: boolean }>('/api/admin/users', { method: 'DELETE', body: JSON.stringify({ id }) }),
  testEmails: () => request<EmailTestResponse>('/api/admin/test-emails', { method: 'POST' }),
  actions: (query: string) => request<ActionsResponse>(`/api/actions${query ? `?${query}` : ''}`),
  closeAction: (body: ActionCloseBody) =>
    request<{ ok: boolean; box_ready: boolean; updated_items: number }>('/api/actions/close', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cloudinarySignature: (uploadType: 'inspection' | 'item_reference') =>
    request<SignatureResponse>('/api/cloudinary-signature', {
      method: 'POST',
      body: JSON.stringify({ upload_type: uploadType }),
    }),
  setItemPhoto: (body: {
    template_item_id?: string | null;
    box_item_id?: string | null;
    item_photo_url: string;
    item_photo_cloudinary_public_id?: string | null;
  }) => request<{ ok: boolean }>('/api/admin/item-photo', { method: 'POST', body: JSON.stringify(body) }),
};
