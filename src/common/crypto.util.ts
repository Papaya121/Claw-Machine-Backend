import { createHash, createHmac, randomBytes } from 'crypto';

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(key: string | Buffer, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function hmacSha256Buffer(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export function base64UrlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

export function base64UrlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

export function randomHex(bytes: number): string {
  return randomBytes(bytes).toString('hex');
}
