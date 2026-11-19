import { Gift, ShoppingCart } from 'lucide-react';

/** Product photo or a kind icon (gift = redeem, cart = earn more). */
export function Thumb({ url, kind, size = 44 }: { url?: string | null; kind: 'redeem' | 'earn'; size?: number }) {
  return url
    ? <img src={url} alt="" className="shrink-0 rounded-lg border border-line object-cover" style={{ width: size, height: size }} />
    : <span className={`inline-flex shrink-0 items-center justify-center rounded-lg ${kind === 'earn' ? 'bg-ok-50 text-ok' : 'bg-brand-50 text-brand'}`} style={{ width: size, height: size }}>
        {kind === 'earn' ? <ShoppingCart size={size * 0.45} /> : <Gift size={size * 0.45} />}
      </span>;
}

