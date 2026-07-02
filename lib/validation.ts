// =============================================================================
// Zod validation schemas - the server-side shape/length/enum gate for every
// submission. The DB CHECK constraints are the final backstop; these give
// clean 400 messages and strip unknown fields BEFORE anything reaches the DB.
// =============================================================================

import { z } from 'zod';
import {
  INSPECTION_PHOTO_FOLDER,
  ITEM_REFERENCE_PHOTO_FOLDER,
} from '@/lib/logic/cloudinary-url.ts';

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');
const appRole = z.enum(['superadmin', 'admin', 'user']);

// --- POST /api/inspections (quick inspection + conditional item check) --------
export const itemCheckInput = z
  .object({
    box_item_id: uuid,
    status: z.enum(['OK', 'Low Qty', 'Missing', 'Expired']),
    observed_quantity: z.number().min(0).max(100000).nullish(),
    new_expiry_date: isoDate.nullish(),
    remark: z.string().trim().max(1000).nullish(),
  })
  .strict();

export const quickInspectionSchema = z
  .object({
    box_id: uuid,
    // The 4 quick-check answers (Yes = true).
    box_accessible: z.boolean(),
    box_clean: z.boolean(),
    seal_intact: z.boolean(),
    contact_visible: z.boolean(),
    notes: z.string().trim().max(2000).nullish(),
    // Box photo is OPTIONAL in the revamped flow.
    box_photo_url: z.string().url().max(500).nullish(),
    box_photo_cloudinary_public_id: z.string().max(200).nullish(),
    submitted_device: z.string().trim().max(120).nullish(),
    // Present only when the item checklist was opened (seal broken / expiry).
    item_check: z.array(itemCheckInput).max(200).optional(),
  })
  .strict();

export type QuickInspectionSubmit = z.infer<typeof quickInspectionSchema>;

// --- GET /api/actions ---------------------------------------------------------
export const actionsQuerySchema = z
  .object({
    status: z.enum(['Open', 'In Progress', 'Closed', 'Rejected', 'all']).optional(),
    box_id: uuid.optional(),
    category: z.enum(['quick_check', 'item']).optional(),
  })
  .strict();

// --- POST /api/actions/close (bulk close + update box items) ------------------
export const actionCloseSchema = z
  .object({
    action_id: uuid,
    closure_note: z.string().trim().max(1000).nullish(),
    items: z
      .array(
        z
          .object({
            box_item_id: uuid,
            after_refill_quantity: z.number().min(0).max(100000).nullish(),
            new_expiry_date: isoDate.nullish(),
          })
          .strict(),
      )
      .max(200)
      .optional(),
  })
  .strict();

// --- POST /api/usage ----------------------------------------------------------
export const usageSchema = z
  .object({
    box_id: uuid,
    user_name: z.string().trim().min(2).max(120),
    department: z.string().trim().min(1).max(120),
    usage_purpose: z.string().trim().min(3).max(500),
    items_taken: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .nullish(),
    notes: z.string().trim().max(1000).nullish(),
    // Honeypot: real users never fill this hidden field; bots often do.
    website: z.string().max(0).optional(),
  })
  .strict();

export type UsageSubmit = z.infer<typeof usageSchema>;

// --- POST /api/cloudinary-signature ------------------------------------------
export const cloudinarySignatureSchema = z
  .object({
    upload_type: z.enum(['inspection', 'item_reference']),
  })
  .strict();

export const FOLDER_BY_UPLOAD_TYPE = {
  inspection: INSPECTION_PHOTO_FOLDER,
  item_reference: ITEM_REFERENCE_PHOTO_FOLDER,
} as const;

// --- POST /api/admin/item-photo ----------------------------------------------
export const itemPhotoSchema = z
  .object({
    template_item_id: uuid,
    item_photo_url: z.string().url().max(500),
    item_photo_cloudinary_public_id: z.string().max(200).nullish(),
  })
  .strict();

// --- /api/admin/users --------------------------------------------------------
export const adminUserCreateSchema = z
  .object({
    email: z.string().trim().email().max(254),
    password: z.string().min(8).max(72),
    full_name: z.string().trim().min(1).max(120),
    employee_id: z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/).nullish(),
    department: z.string().trim().max(120).nullish(),
    role: appRole,
    is_active: z.boolean().default(true),
  })
  .strict();

export const adminUserUpdateSchema = z
  .object({
    id: uuid,
    full_name: z.string().trim().min(1).max(120).optional(),
    employee_id: z.string().trim().regex(/^[A-Za-z0-9_-]{2,32}$/).nullable().optional(),
    department: z.string().trim().max(120).nullable().optional(),
    role: appRole.optional(),
    is_active: z.boolean().optional(),
  })
  .strict();

export const adminUserDeleteSchema = z
  .object({
    id: uuid,
  })
  .strict();

// --- GET /api/reports (query params) -----------------------------------------
export const reportsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    box_id: uuid.optional(),
    area: z.string().trim().max(120).optional(),
    status: z.enum(['Ready', 'Action Required']).optional(),
  })
  .strict();

export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

/** Parse a body and convert a ZodError into a single clean message string. */
export function firstZodMessage(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'Invalid request.';
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}
