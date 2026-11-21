import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes } from 'crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config';
import { E } from '../common/errors';
import { safeEqual } from '../common/util';

export const UPLOAD_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
// Signed into the S3 URL, so the app must send the same header or S3 answers 403 SignatureDoesNotMatch.
const CACHE_CONTROL = 'public, max-age=31536000, immutable';
export type UploadPurpose = 'product' | 'ad' | 'logo' | 'bill';

/**
 * Photo uploads. The app asks for an upload slot, PUTs the image bytes straight to it, then saves the
 * returned URL on the product/ad. Bytes never pass through the API in production.
 *  - S3 (S3_BUCKET set): presigned PUT, 10 minutes; public URL via S3_PUBLIC_BASE_URL (CloudFront).
 *  - Local (development): PUT to this API, stored under ./uploads, served at /v1/files/<key>.
 */
@Injectable()
export class UploadsService {
  private s3 = config.uploads.bucket ? new S3Client({ region: config.uploads.region }) : null;
  private localDir = resolve(config.uploads.localDir);

  async createSlot(owner: string, purpose: UploadPurpose, contentType: string, size: number) {
    const ext = UPLOAD_TYPES[contentType];
    if (!ext) throw E.bad('BAD_FILE_TYPE', 'Use a JPG, PNG or WebP photo');
    if (!(size > 0) || size > MAX_UPLOAD_BYTES) throw E.bad('FILE_TOO_BIG', 'Photo must be under 2 MB');
    const day = new Date().toISOString().slice(0, 10);
    const key = `${purpose}/${day}/${owner}-${randomBytes(9).toString('base64url')}.${ext}`;
    if (this.s3) {
      const uploadUrl = await getSignedUrl(this.s3, new PutObjectCommand({
        Bucket: config.uploads.bucket, Key: key, ContentType: contentType, ContentLength: size, CacheControl: CACHE_CONTROL,
      }), { expiresIn: 600 });
      return { uploadUrl, method: 'PUT' as const, headers: { 'Content-Type': contentType, 'Cache-Control': CACHE_CONTROL }, url: `${config.uploads.publicBaseUrl.replace(/\/$/, '')}/${key}` };
    }
    const exp = Math.floor(Date.now() / 1000) + 600;
    const sig = this.sign(key, contentType, exp);
    const base = config.publicApiUrl.replace(/\/$/, '');
    return {
      uploadUrl: `${base}/uploads/local/${encodeURIComponent(key)}?exp=${exp}&ct=${encodeURIComponent(contentType)}&sig=${sig}`,
      method: 'PUT' as const, headers: { 'Content-Type': contentType }, url: `${base}/files/${key}`,
    };
  }

  private sign(key: string, ct: string, exp: number) {
    return createHmac('sha256', config.jwtSecret).update(`upload|${key}|${ct}|${exp}`).digest('base64url');
  }

  /** Development only: accepts the PUT the slot points at. */
  saveLocal(key: string, q: { exp?: string; ct?: string; sig?: string }, body: Buffer | undefined, contentType?: string) {
    if (this.s3) throw E.notFound('Upload');
    const exp = Number(q.exp);
    if (!q.sig || !q.ct || !exp || exp < Date.now() / 1000 || !safeEqual(this.sign(key, q.ct, exp), q.sig)) throw E.forbidden('BAD_UPLOAD', 'Upload link expired. Try again.');
    if ((contentType ?? '').split(';')[0] !== q.ct) throw E.bad('BAD_FILE_TYPE', 'File type does not match');
    if (!body?.length || body.length > MAX_UPLOAD_BYTES) throw E.bad('FILE_TOO_BIG', 'Photo must be under 2 MB');
    const path = this.safePath(key);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, body);
    return { ok: true };
  }

  readLocal(key: string): { body: Buffer; type: string } {
    const path = this.safePath(key);
    if (!existsSync(path)) throw E.notFound('File');
    const ext = key.split('.').pop()!;
    const type = Object.entries(UPLOAD_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    return { body: readFileSync(path), type };
  }

  private safePath(key: string) {
    if (!/^(product|ad|logo|bill)\/\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]+\.(jpg|png|webp)$/.test(key)) throw E.bad('BAD_KEY', 'Bad file name');
    const p = resolve(this.localDir, key);
    if (!p.startsWith(this.localDir)) throw E.bad('BAD_KEY', 'Bad file name');
    return p;
  }
}
