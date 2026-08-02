// ---------------------------------------------------------------------------
// Password generation for admin-created accounts.
// ---------------------------------------------------------------------------
// Used by the admin New User form and by superadmin provisioning, where someone
// sets a password ON BEHALF of another person. Ambiguous glyphs (O/0, l/1/I) are
// left out on purpose: these get read off a screen and typed by someone else, or
// dictated over the phone.
//
// crypto.getRandomValues, not Math.random — this is a real credential.
export function generatePassword(len = 14): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%*?'
  const bytes = new Uint32Array(len)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
}
