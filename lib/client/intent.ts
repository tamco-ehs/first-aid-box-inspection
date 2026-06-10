'use client';

// Remembers where an unauthenticated user was trying to go (e.g. a box link
// from a QR code) so login can send them back there afterwards.

const KEY = 'fais:intended-path';

export function setIntendedPath(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    /* ignore */
  }
}

export function takeIntendedPath(): string | null {
  try {
    const v = sessionStorage.getItem(KEY);
    if (v) sessionStorage.removeItem(KEY);
    return v;
  } catch {
    return null;
  }
}
