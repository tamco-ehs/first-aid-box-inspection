export function validatePasswordReset(password: string, confirmPassword: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (password.length > 72) return 'Password must be 72 characters or fewer.';
  if (/\s/.test(password)) return 'Password cannot contain spaces.';
  if (password !== confirmPassword) return 'Passwords do not match.';
  return null;
}

export function isPasswordResetRateLimit(message: string): boolean {
  return /rate|security purposes|too many|over.*limit/i.test(message);
}
