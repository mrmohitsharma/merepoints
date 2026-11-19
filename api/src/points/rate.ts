/** One slab: bills from `from_paise` upward (until the next slab) earn `bps` (500 = 5%) on the whole bill. */
export type Slab = { from_paise: number; bps: number };

/** The % (in basis points) for a bill, from the shop's loyalty config row. */
export function rateBpsFor(cfg: { reward_bps: number; reward_slabs?: Slab[] | null }, amountPaise: number): number {
  const slabs = cfg.reward_slabs;
  if (!slabs?.length) return cfg.reward_bps;
  let bps = slabs[0].bps;
  for (const s of slabs) if (amountPaise >= s.from_paise) bps = s.bps;
  return bps;
}

/** Points before offers and caps: floor(bill × %). */
export const basePoints = (amountPaise: number, bps: number) => Math.floor((amountPaise * bps) / 1_000_000);

export const presentSlabs = (slabs?: Slab[] | null) =>
  slabs?.length ? slabs.map((s) => ({ fromRupees: s.from_paise / 100, percent: s.bps / 100 })) : null;
