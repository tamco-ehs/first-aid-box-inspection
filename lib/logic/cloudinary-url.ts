// =============================================================================
// Cloudinary URL validation - pure guard used to reject any photo URL that does
// not belong to OUR Cloudinary account and one of OUR approved folders. This
// stops a caller from storing an arbitrary attacker-controlled image URL in the
// database (the DB CHECK only enforces the res.cloudinary.com prefix).
// =============================================================================

export const INSPECTION_PHOTO_FOLDER = 'first-aid/inspection-photos';
export const ITEM_REFERENCE_PHOTO_FOLDER = 'first-aid/item-reference-photos';
export const ALLOWED_UPLOAD_FOLDERS = [
  INSPECTION_PHOTO_FOLDER,
  ITEM_REFERENCE_PHOTO_FOLDER,
] as const;

export const ALLOWED_IMAGE_FORMATS = ['jpg', 'jpeg', 'png', 'webp'] as const;

/**
 * True only when `url` is a delivery URL on our cloud, under one of the
 * approved folders, ending in an allowed image extension.
 *
 * Accepts the standard Cloudinary delivery shape, tolerating an optional
 * version segment and transformation segment:
 *   https://res.cloudinary.com/<cloud>/image/upload/[v123/]<folder>/<name>.<ext>
 */
export function isAllowedCloudinaryUrl(
  url: string,
  cloudName: string,
  allowedFolders: readonly string[] = ALLOWED_UPLOAD_FOLDERS,
): boolean {
  if (!url || !cloudName) return false;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'https:') return false;
  if (parsed.hostname !== 'res.cloudinary.com') return false;

  // Path must start with our cloud name and the image/upload delivery type.
  const prefix = `/${cloudName}/image/upload/`;
  if (!parsed.pathname.startsWith(prefix)) return false;

  // One of our folders must appear as a path segment.
  const inApprovedFolder = allowedFolders.some((folder) =>
    parsed.pathname.includes(`/${folder}/`),
  );
  if (!inApprovedFolder) return false;

  // Extension check (defends against e.g. ".svg" / ".html" trickery).
  const ext = parsed.pathname.split('.').pop()?.toLowerCase() ?? '';
  if (!(ALLOWED_IMAGE_FORMATS as readonly string[]).includes(ext)) return false;

  return true;
}
