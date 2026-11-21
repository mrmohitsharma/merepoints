import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { z } from 'zod';
import { E } from './errors';

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I confusion when read out loud

/** Human-friendly public reference, e.g. VP-ER-7K2M9Q. Unique constraint backs it. */
export function publicId(prefix: 'ER' | 'MN' | 'RD' | 'RV' | 'RH' | 'RC' | 'RL' | 'EX'): string {
  let s = '';
  for (let i = 0; i < 7; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return `VP-${prefix}-${s}`;
}

/** Accepts 10-digit Indian numbers with or without +91 / 0, returns 91XXXXXXXXXX. */
export function normalizeMobile(raw: string): string {
  const d = String(raw).replace(/\D/g, '');
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 11 && d.startsWith('0') ? d.slice(1) : d;
  if (!/^[6-9]\d{9}$/.test(ten)) throw E.bad('BAD_MOBILE', 'Enter a valid 10-digit mobile number');
  return `91${ten}`;
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const hmac = (secret: string, s: string) => createHmac('sha256', secret).update(s).digest('base64url');
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const randomDigits = (n: number) => Array.from({ length: n }, () => randomInt(10)).join('');

/** Rupees (number, max 2 decimals) -> paise integer. */
export const toPaise = (rupees: number) => Math.round(rupees * 100);

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  return schema.parse(input ?? {});
}

/** Builds simple RFC-4180 CSV. */
export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = v instanceof Date ? v.toISOString() : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => esc(r[c])).join(','))].join('\n');
}

/** Password hashing: scrypt with a random salt. Format: scrypt$<salt>$<hash> (base64url). */
const scrypt = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scryptCb(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${(await scrypt(pw, salt)).toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  const [kind, salt, hash] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'));
  const want = Buffer.from(hash, 'base64url');
  return got.length === want.length && timingSafeEqual(got, want);
}
