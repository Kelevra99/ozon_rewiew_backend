import * as crypto from 'crypto';

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function buildRawApiKey(prefix: string): string {
  const token = crypto.randomBytes(24).toString('hex');
  return `${prefix}${token}`;
}
