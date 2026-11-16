import { Injectable } from '@nestjs/common';
import { Db, Q } from '../db/db.service';

export interface Milestone { id: number; name: string; threshold: number; color: string; perks: string[] }
type Totals = { lifetime_points: number; lifetime_value_paise: number };

/**
 * Milestones are configured by the super admin. Basis is platform-wide:
 *  'points' -> lifetime points earned; 'value' -> lifetime rupee value earned (threshold in paise).
 * Tiny table, read on every earn: cached for 60 s.
 */
@Injectable()
export class MilestoneService {
  private cache: { at: number; basis: 'points' | 'value'; list: Milestone[] } | null = null;
  constructor(private db: Db) {}

  invalidate() { this.cache = null; }

  async load(q: Q = this.db.pool) {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache;
    const list = await this.db.many<Milestone>('SELECT id, name, threshold, color, perks FROM milestones WHERE active ORDER BY threshold', [], q);
    const s = await this.db.one(`SELECT value FROM platform_settings WHERE key = 'milestone_basis'`, [], q);
    this.cache = { at: Date.now(), basis: s?.value === 'value' ? 'value' : 'points', list };
    return this.cache;
  }

  private score(t: Totals, basis: 'points' | 'value') {
    return Number(basis === 'value' ? t.lifetime_value_paise : t.lifetime_points);
  }

  async current(t: Totals) {
    const { list, basis } = await this.load();
    const s = this.score(t, basis);
    return [...list].reverse().find((m) => s >= m.threshold) ?? null;
  }

  /** Returns the milestone newly reached by this credit, if any (app shows the "level up" screen). */
  async crossed(before: Totals, after: Totals, q?: Q) {
    const { list, basis } = await this.load(q);
    const b = this.score(before, basis), a = this.score(after, basis);
    const hit = list.filter((m) => m.threshold > 0 && b < m.threshold && a >= m.threshold).pop();
    return hit ? { id: hit.id, name: hit.name, color: hit.color, perks: hit.perks } : null;
  }

  /**
   * The home-screen window: last crossed, next (with progress), and the one after.
   * If nothing is crossed yet the window starts at the first level.
   */
  async window(t: Totals) {
    const { list, basis } = await this.load();
    const s = this.score(t, basis);
    const idx = list.findIndex((m) => m.threshold > s); // first not yet reached
    const lastIdx = idx === -1 ? list.length - 1 : idx - 1;
    const start = Math.max(0, Math.min(lastIdx, list.length - 3));
    const unit = basis === 'value' ? 'rupees' : 'points';
    const fmt = (v: number) => (basis === 'value' ? v / 100 : v);
    return {
      basis: unit,
      earnedSoFar: fmt(s),
      current: lastIdx >= 0 ? list[lastIdx].name : null,
      tiles: list.slice(start, start + 3).map((m, i) => {
        const j = start + i;
        const state = j <= lastIdx ? 'crossed' : j === idx ? 'next' : 'locked';
        const prevT = j > 0 ? list[j - 1].threshold : 0;
        return {
          id: m.id, name: m.name, color: m.color, perks: m.perks, threshold: fmt(m.threshold), state,
          ...(state === 'next' ? {
            toGo: fmt(m.threshold - s),
            progress: Math.min(1, Math.max(0, (s - prevT) / Math.max(1, m.threshold - prevT))),
          } : {}),
        };
      }),
    };
  }
}
