import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { E } from './errors';

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, LEN = 32;

/** scrypt$N$r$p$salt$hash (base64url). Memory-hard, built into Node, no native deps. */
export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw, salt, LEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024 });
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** At least 10 characters with a letter and a number. Admins can approve shops and cancel payouts. */
export function assertStrongPassword(pw: string) {
  if (pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw E.bad('WEAK_PASSWORD', 'Password needs at least 10 characters, with letters and numbers');
  }
}
