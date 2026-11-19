'use client';

import { adminApi, ApiError, merchantApi } from './api';
import type { Portal } from './api';

const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Ask the API for an upload slot, PUT the file straight to storage (S3 in production), return its public URL. */
export async function uploadPhoto(portal: Portal, file: File, purpose: 'product' | 'ad' | 'logo'): Promise<string> {
  if (!TYPES.includes(file.type)) throw new ApiError(400, 'BAD_FILE_TYPE', 'Use a JPG, PNG or WebP image');
  if (file.size > 2 * 1024 * 1024) throw new ApiError(400, 'FILE_TOO_BIG', 'Image must be under 2 MB');
  const api = portal === 'admin' ? adminApi : merchantApi;
  const slot = await api.post<{ uploadUrl: string; headers: Record<string, string>; url: string }>(portal === 'admin' ? 'admin/uploads' : 'uploads', {
    purpose, contentType: file.type, size: file.size,
  });
  let res: Response;
  try {
    res = await fetch(slot.uploadUrl, { method: 'PUT', headers: slot.headers, body: file });
  } catch {
    throw new ApiError(0, 'NETWORK', 'Upload failed. Check your internet and try again.');
  }
  if (!res.ok) throw new ApiError(res.status, 'UPLOAD_FAILED', 'Upload failed. Please try again.');
  return slot.url;
}

/** Reads an image's pixel size (to warn about banners that are not 1080×450). */
export function imageSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); URL.revokeObjectURL(img.src); };
    img.onerror = () => resolve({ w: 0, h: 0 });
    img.src = URL.createObjectURL(file);
  });
}
