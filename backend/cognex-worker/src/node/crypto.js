/**
 * crypto.js — AES-256-GCM helpers used to encrypt TOTP secrets at rest.
 *
 * TOTP_ENC_KEY: 64 hex chars (32 bytes). Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 * Stored format:  v1:<iv b64>:<tag b64>:<ciphertext b64>
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function keyFrom(hex) {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('TOTP_ENC_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plain, hexKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(hexKey), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptSecret(stored, hexKey) {
  const [v, iv, tag, enc] = String(stored).split(':');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(hexKey), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(enc, 'base64')), decipher.final()]).toString('utf8');
}
