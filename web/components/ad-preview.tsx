/** How the banner looks in the customer app's Home carousel (no "Ad" label, as decided). */
export function AdPreview({ title, subtitle, imageUrl, bgColor, opensLabel }: { title?: string; subtitle?: string | null; imageUrl?: string | null; bgColor?: string | null; opensLabel?: string | null }) {
  return (
    <div className="mx-auto w-[300px] rounded-[28px] border-[6px] border-ink bg-page p-3 shadow-lg">
      <div className="mb-2 h-3 rounded bg-line/70" />
      <div className="mb-3 h-14 rounded-xl bg-white" />
      <div className="relative overflow-hidden rounded-2xl" style={{ aspectRatio: '1080 / 450', background: bgColor ?? '#0F4C81' }}>
        {imageUrl
          ? <img src={imageUrl} alt="" className="h-full w-full object-cover" />
          : (
            <div className="flex h-full flex-col justify-center px-4">
              <div className="line-clamp-2 text-[15px] font-extrabold leading-tight text-white">{title || 'Your headline'}</div>
              {subtitle && <div className="mt-1 line-clamp-2 text-xs text-white/75">{subtitle}</div>}
            </div>
          )}
      </div>
      <div className="mt-1.5 flex justify-center gap-1"><span className="h-1.5 w-4 rounded bg-brand" /><span className="h-1.5 w-1.5 rounded bg-line" /><span className="h-1.5 w-1.5 rounded bg-line" /></div>
      {opensLabel && <p className="mt-2 text-center text-[11px] text-muted">Tap opens: {opensLabel}</p>}
      <div className="mt-2 grid grid-cols-3 gap-1.5">{[0, 1, 2].map((i) => <div key={i} className="aspect-[3/4] rounded-lg bg-white" />)}</div>
    </div>
  );
}

export const AD_COLORS = ['#0F4C81', '#1D4ED8', '#15803D', '#7C2D12', '#B45309', '#9D174D', '#4C1D95', '#111827'];
