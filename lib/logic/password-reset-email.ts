function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
}

export function buildPasswordResetEmail(appUrl: string, tokenHash: string) {
  const url = new URL('/reset-password', appUrl);
  // Fragments stay out of server logs and are not consumed by email link scanners.
  url.hash = new URLSearchParams({ token_hash: tokenHash, type: 'recovery' }).toString();
  const link = url.toString();
  const subject = 'Reset your TAMCO First Aid password';
  const text = `Reset your password\n\nOpen this link and enter your new password:\n${link}\n\nUse the newest reset email. This link can only be used once and expires according to the account security settings.\n\nIf you did not request this, ignore this email. Your password has not changed.\n\nTAMCO EHS | First Aid Box Inspection`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#17212b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fff;border:1px solid #dde5df;border-radius:8px">
<tr><td style="padding:20px 24px;background:#15803d;color:#fff;font-weight:bold">TAMCO EHS &nbsp; | &nbsp; First Aid</td></tr>
<tr><td style="padding:24px"><h1 style="font-size:24px;margin:0 0 16px">Reset your password</h1>
<p style="line-height:1.6">Open the link below and enter your new password.</p>
<p style="margin:24px 0"><a href="${escapeHtml(link)}" style="display:inline-block;padding:14px 22px;background:#15803d;border-radius:6px;color:#fff;font-weight:bold;text-decoration:none">Set new password</a></p>
<p style="font-size:13px;line-height:1.6;color:#52616b">Use the newest reset email. This link can only be used once and expires according to your account security settings.</p>
<p style="font-size:13px;line-height:1.6;color:#52616b">Didn't request this? Ignore this email. Your password has not changed.</p>
<p style="font-size:12px;line-height:1.6;word-break:break-all">Button not working? Copy this link into your browser:<br><a href="${escapeHtml(link)}">${escapeHtml(link)}</a></p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}
