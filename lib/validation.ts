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

const volumeLevel = z.enum(['Full', 'Three Quarter', 'Half', 'Below Half', 'Empty']);
const presentStatus = z.enum(['Present', 'Missing', 'Damaged']);

// --- POST /api/inspections ----------------------------------------------------
export const inspectionItemInput = z
  .object({
    box_item_id: uuid,
    observed_quantity: z.number().min(0).max(100000).nullish(),
    observed_volume_level: volumeLevel.nullish(),
    observed_present_status: presentStatus.nullish(),
    expiry_date: isoDate.nullish(),
    remarks: z.string().trim().max(1000).nullish(),
  })
  .strict();

export const inspectionSubmitSchema = z
  .object({
    box_id: uuid,
    // Accepted but ignored server-side: the DB trigger snapshots the real
    // inspector identity from the profile (anti-spoofing). Kept for clients.
    inspector_name: z.string().trim().max(120).nullish(),
    inspector_department: z.string().trim().max(120).nullish(),
    notes: z.string().trim().max(2000).nullish(),
    box_photo_url: z.string().url().max(500),
    box_photo_cloudinary_public_id: z.string().max(200).nullish(),
    submitted_device: z.string().trim().max(120).nullish(),
    inspection_items: z.array(inspectionItemInput).min(1).max(200),
  })
  .strict();

export type InspectionSubmit = z.infer<typeof inspectionSubmitSchema>;

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
    template_item_id: uuid.nullish(),
    box_item_id: uuid.nullish(),
    item_photo_url: z.string().url().max(500),
    item_photo_cloudinary_public_id: z.string().max(200).nullish(),
  })
  .strict()
  .refine((v) => Boolean(v.template_item_id) !== Boolean(v.box_item_id), {
    message: 'Provide exactly one of template_item_id or box_item_id.',
  });

// --- GET /api/reports (query params) -----------------------------------------
export const reportsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    box_id: uuid.optional(),
    area: z.string().trim().max(120).optional(),
    inspector_id: uuid.optional(),
    department: z.string().trim().max(120).optional(),
    status: z.enum(['Pass', 'Fail', 'Needs Restock']).optional(),
    issue_type: z
      .enum(['expired', 'expiring_soon', 'missing', 'low_stock', 'damaged', 'topup'])
      .optional(),
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
