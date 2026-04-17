import { createHash, createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function hmacSha256(key, body) {
  return createHmac('sha256', key).update(body).digest('hex');
}

export function safeEquals(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function newNonce() {
  return randomBytes(16).toString('hex');
}
