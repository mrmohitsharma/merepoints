'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Camera, CameraOff, RefreshCw, X } from 'lucide-react';

type State = 'starting' | 'scanning' | 'denied' | 'nocamera' | 'insecure' | 'error';

/**
 * Full-screen camera scanner for the customer's Mere Points QR (starts with VP1.).
 * Uses the browser camera (asks for permission on open) and decodes with jsQR, so it works on
 * Chrome, Edge, Safari and Firefox on laptops, tablets and phones. The camera needs https (or localhost).
 */
export function QrScanDialog({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const done = useRef(false);
  const [state, setState] = useState<State>('starting');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [seen, setSeen] = useState(false);

  const stop = useCallback(() => {
    clearTimeout(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }, []);

  const start = useCallback(async (id?: string) => {
    stop();
    setState('starting');
    if (typeof window === 'undefined' || !window.isSecureContext) { setState('insecure'); return; }
    if (!navigator.mediaDevices?.getUserMedia) { setState('nocamera'); return; }
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      if (done.current) { s.getTracks().forEach((t) => t.stop()); return; }
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      v.setAttribute('playsinline', 'true');
      await v.play();
      setDevices((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      setDeviceId(s.getVideoTracks()[0]?.getSettings().deviceId);
      setState('scanning');
      tick();
    } catch (e: any) {
      const name = e?.name ?? '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('nocamera');
      else setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stop]);

  function tick() {
    const v = video.current;
    if (done.current || !v) return;
    if (v.readyState >= 2 && v.videoWidth) {
      const c = (canvas.current ??= document.createElement('canvas'));
      const scale = Math.min(1, 640 / v.videoWidth);
      c.width = Math.round(v.videoWidth * scale);
      c.height = Math.round(v.videoHeight * scale);
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      const hit = jsQR(img.data, c.width, c.height, { inversionAttempts: 'dontInvert' });
      if (hit?.data) {
        if (hit.data.startsWith('VP1.')) {
          done.current = true;
          stop();
          if (navigator.vibrate) navigator.vibrate(60);
          onCode(hit.data);
          return;
        }
        setSeen(true); // a QR, but not ours
      }
    }
    raf.current = window.setTimeout(() => requestAnimationFrame(tick), 90);
  }

  useEffect(() => {
    done.current = false;
    start();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { done.current = true; window.removeEventListener('keydown', esc); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const msg: Record<Exclude<State, 'starting' | 'scanning'>, string> = {
    denied: 'Camera is blocked for this page. Click the camera icon in the address bar, choose Allow, then tap Try again.',
    nocamera: 'No camera found on this device. Type the mobile number instead, or use a USB scanner.',
    insecure: 'The camera only works on a secure (https) page. Open the portal with its https address.',
    error: 'Could not start the camera. Close other apps that use it and try again.',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" role="dialog" aria-modal="true" aria-label="Scan customer QR">
      <div className="w-full max-w-md overflow-hidden rounded-3xl bg-[#10161d] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 text-white">
          <div className="font-bold">Scan customer QR</div>
          <button onClick={onClose} className="rounded-full bg-white/15 p-2 hover:bg-white/25" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="relative aspect-square w-full bg-black">
          <video ref={video} muted playsInline className="h-full w-full object-cover" />
          {state === 'scanning' && (
            <>
              <div className="pointer-events-none absolute inset-[18%] rounded-3xl border-4 border-amber-400 shadow-[0_0_0_999px_rgba(0,0,0,0.45)]" />
              <div className="pointer-events-none absolute inset-x-[22%] top-[20%] h-[3px] animate-[scanline_1.8s_ease-in-out_infinite_alternate] rounded bg-amber-400" />
            </>
          )}
          {state !== 'scanning' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-white">
              {state === 'starting' ? (
                <><Camera size={40} className="text-amber-400" /><p>Asking for camera access… tap <b>Allow</b> in the browser box.</p></>
              ) : (
                <>
                  <CameraOff size={40} className="text-amber-400" />
                  <p className="text-sm leading-relaxed">{msg[state]}</p>
                  {state !== 'nocamera' && state !== 'insecure' && (
                    <button onClick={() => start()} className="rounded-xl bg-amber-400 px-5 py-2.5 font-bold text-black">Try again</button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-white/80">
          <span>{seen ? 'That QR is not a Mere Points code.' : 'Ask the customer to open Mere Points › My QR'}</span>
          {devices.length > 1 && (
            <button
              onClick={() => { const i = devices.findIndex((d) => d.deviceId === deviceId); start(devices[(i + 1) % devices.length].deviceId); }}
              className="flex shrink-0 items-center gap-1.5 rounded-lg bg-white/15 px-3 py-1.5 hover:bg-white/25"
            ><RefreshCw size={14} /> Switch camera</button>
          )}
        </div>
      </div>
    </div>
  );
}
