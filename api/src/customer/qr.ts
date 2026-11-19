import { config } from '../config';
import { hmac, safeEqual } from '../common/util';
import { E } from '../common/errors';

/**
 * Rotating customer QR, no DB write per rotation:
 *   VP1.<customerId>.<window>.<mac>
 * window = floor(unix / 60). A screenshot stops working within ~2 minutes.
 * Verification accepts the current and previous window (clock skew / slow scan).
 */
export function makeQr(customerId: number, now = Date.now()) {
  const w = Math.floor(now / 1000 / config.qrWindowSeconds);
  const mac = hmac(config.qrSecret, `${customerId}.${w}`).slice(0, 16);
  const expiresAt = new Date((w + 1) * config.qrWindowSeconds * 1000);
  return { qr: `VP1.${customerId}.${w}.${mac}`, expiresAt };
}

export function readQr(token: string, now = Date.now()): number {
  const m = /^VP1\.(\d+)\.(\d+)\.([A-Za-z0-9_-]{16})$/.exec(token.trim());
  if (!m) throw E.bad('QR_INVALID', 'This is not a Mere Points customer QR');
  const [, cid, win, mac] = m;
  const current = Math.floor(now / 1000 / config.qrWindowSeconds);
  const w = Number(win);
  if (w < current - 1 || w > current + 1) throw E.bad('QR_EXPIRED', 'QR has expired. Ask the customer to open My QR again.');
  if (!safeEqual(mac, hmac(config.qrSecret, `${cid}.${w}`).slice(0, 16))) throw E.bad('QR_INVALID', 'QR could not be verified');
  return Number(cid);
}
