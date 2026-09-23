import { buildPasswordResetEmail } from './password-reset-email.ts';

export interface ResetRequestDependencies {
  claim: (email: string) => Promise<number>;
  generate: (email: string) => Promise<{ tokenHash: string; userId: string; email: string } | null>;
  isActive: (userId: string) => Promise<boolean>;
  send: (message: { to: string[]; subject: string; html: string; text: string }) => Promise<{ ok: boolean }>;
}

export async function requestPasswordReset(email: string, appUrl: string, deps: ResetRequestDependencies) {
  const normalized = email.trim().toLowerCase();
  // Apply the same counters and response to existing and unknown accounts.
  const retryAfter = await deps.claim(normalized);
  if (retryAfter > 0) return { status: 429 as const, retryAfter };
  const recovery = await deps.generate(normalized);
  if (recovery && await deps.isActive(recovery.userId)) {
    const result = await deps.send({
      to: [recovery.email],
      ...buildPasswordResetEmail(appUrl, recovery.tokenHash),
    });
    if (!result.ok) throw new Error('reset_delivery_failed');
  }
  return { status: 200 as const, retryAfter: 60 };
}
