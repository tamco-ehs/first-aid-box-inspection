// =============================================================================
// HTTP helpers - consistent JSON responses and a single place that turns thrown
// errors into clean, non-leaky responses. Internal errors NEVER expose stack
// traces, SQL, or secrets to the client; the real detail is logged server-side.
// =============================================================================

/** A controlled, client-safe failure. Anything else becomes a generic 500. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const unauthorized = (msg = 'Authentication required.') =>
  new ApiError(401, 'unauthorized', msg);
export const forbidden = (msg = 'You do not have access to this resource.') =>
  new ApiError(403, 'forbidden', msg);
export const badRequest = (msg = 'Invalid request.') => new ApiError(400, 'bad_request', msg);
export const notFound = (msg = 'Not found.') => new ApiError(404, 'not_found', msg);
export const tooManyRequests = (msg = 'Too many requests. Please try again later.') =>
  new ApiError(429, 'rate_limited', msg);

export function jsonOk(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function jsonError(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Wrap a route body so every throw becomes a clean response. Known ApiErrors
 * pass their (safe) message through; everything else is logged and returned as
 * a generic 500 with no internal detail.
 */
export async function safe(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) {
      return jsonError(err.status, err.code, err.message);
    }
    // Real detail stays on the server only.
    console.error('[api] unhandled error:', err);
    return jsonError(500, 'internal_error', 'Something went wrong. Please try again.');
  }
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip')?.trim() || '0.0.0.0';
}
