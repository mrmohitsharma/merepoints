import { Injectable } from '@nestjs/common';
import { Db, Q } from '../db/db.service';
import { E } from '../common/errors';
import { loadEntitlements } from '../billing/entitlements';
import { ShopService } from '../shop/shop.service';

export const LEVEL_NAMES = ['Silver', 'Gold', 'Platinum'] as const;
const IST_DATE = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
const rupees = (paise: number | string) => Number(paise) / 100;
const inr = (n: number) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

export type GoalRow = {
  id: number; kind: 'visits' | 'spend'; target: string | number; period_days: number; bonus_points: number; starts_on: string;
  visits?: number; spend_paise?: string | number; awarded?: boolean; win_end?: string; window_no?: number;
};

/** "5 visits in 30 days" / "Spend ₹50,000 in 30 days" */
export function goalLabel(g: { kind: string; target: string | number; period_days: number }) {
  return g.kind === 'visits'
    ? `${Number(g.target)} visits in ${g.period_days} days`
    : `Spend ${inr(rupees(g.target))} in ${g.period_days} days`;
}

/**
 * Shop levels (higher reward % on every bill, decided by spend in the last 12 months) and loyalty goals
 * (visits or spend inside a period earn bonus points, repeating every period). Both are package features.
 */
@Injectable()
export class PerksService {
  constructor(private db: Db, private shops: ShopService) {}

  // ------------------------------------------------------------------ used while earning
  async features(q: Q, shopId: number) {
    const f = (await loadEntitlements(q, shopId)).features;
    return { levels: f.includes('shop_levels'), goals: f.includes('loyalty_goals') };
  }

  async spend12m(q: Q, shopId: number, customerId: number) {
    const r = await q.query(
      `SELECT COALESCE(sum(amount_paise), 0)::bigint AS s FROM bills
        WHERE shop_id = $1 AND customer_id = $2 AND reversed_at IS NULL AND created_at > now() - interval '365 days'`, [shopId, customerId]);
    return Number(r.rows[0].s);
  }

  async levels(q: Q, shopId: number) {
    return (await q.query('SELECT rank, min_spend_paise, reward_bps FROM shop_levels WHERE shop_id = $1 ORDER BY rank', [shopId])).rows as
      { rank: number; min_spend_paise: string; reward_bps: number }[];
  }

  /** The level a customer has right now at this shop (null = none yet), plus the next one to reach. */
  static levelFor(levels: { rank: number; min_spend_paise: string; reward_bps: number }[], spendPaise: number) {
    let current: (typeof levels)[number] | null = null;
    let next: (typeof levels)[number] | null = null;
    for (const l of levels) {
      if (spendPaise >= Number(l.min_spend_paise)) current = l;
      else if (!next) next = l;
    }
    return { current, next };
  }

  /** Goals with this customer's progress in the current period. */
  async goalsWithProgress(q: Q, shopId: number, customerId: number | null): Promise<GoalRow[]> {
    const r = await q.query(
      `SELECT g.id, g.kind, g.target, g.period_days, g.bonus_points, g.starts_on, w.no AS window_no,
              (g.starts_on + (w.no + 1) * g.period_days) AS win_end,
              (SELECT count(*)::int FROM bills b WHERE b.shop_id = g.shop_id AND b.customer_id = $2 AND b.reversed_at IS NULL
                  AND (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= g.starts_on + w.no * g.period_days
                  AND (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <  g.starts_on + (w.no + 1) * g.period_days) AS visits,
              (SELECT COALESCE(sum(b.amount_paise), 0)::bigint FROM bills b WHERE b.shop_id = g.shop_id AND b.customer_id = $2 AND b.reversed_at IS NULL
                  AND (b.created_at AT TIME ZONE 'Asia/Kolkata')::date >= g.starts_on + w.no * g.period_days
                  AND (b.created_at AT TIME ZONE 'Asia/Kolkata')::date <  g.starts_on + (w.no + 1) * g.period_days) AS spend_paise,
              EXISTS (SELECT 1 FROM goal_awards a WHERE a.goal_id = g.id AND a.customer_id = $2 AND a.window_no = w.no) AS awarded
         FROM shop_goals g
         CROSS JOIN LATERAL (SELECT floor((${IST_DATE} - g.starts_on)::numeric / g.period_days)::int AS no) w
        WHERE g.shop_id = $1 AND g.active
        ORDER BY g.id`, [shopId, customerId ?? 0]);
    return r.rows as GoalRow[];
  }

  /**
   * Called inside the earning transaction after the bill is saved. Records an award for every goal this customer has just reached
   * in the current period and returns them so the caller can credit the bonus points.
   */
  async dueGoals(q: Q, shopId: number, customerId: number) {
    const due: { goalId: number; label: string; points: number }[] = [];
    for (const g of await this.goalsWithProgress(q, shopId, customerId)) {
      if (g.awarded) continue;
      const done = g.kind === 'visits' ? Number(g.visits) : Number(g.spend_paise);
      if (done < Number(g.target)) continue;
      const ins = await q.query(
        `INSERT INTO goal_awards (goal_id, shop_id, customer_id, window_no, points) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (goal_id, customer_id, window_no) DO NOTHING RETURNING id`, [g.id, shopId, customerId, g.window_no, g.bonus_points]);
      if (ins.rowCount) due.push({ goalId: g.id, label: goalLabel(g), points: g.bonus_points });
    }
    return due;
  }

  // ------------------------------------------------------------------ presenting
  static presentGoal(g: GoalRow, withProgress: boolean) {
    const target = g.kind === 'visits' ? Number(g.target) : rupees(g.target);
    const out: Record<string, unknown> = {
      id: Number(g.id), kind: g.kind, target, periodDays: g.period_days, bonusPoints: g.bonus_points, label: goalLabel(g),
    };
    if (withProgress) {
      const done = g.kind === 'visits' ? Number(g.visits ?? 0) : rupees(g.spend_paise ?? 0);
      const end = g.win_end ? new Date(g.win_end as any) : null;
      const daysLeft = end ? Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000)) : null;
      out.progress = { done: Math.min(done, target), target, achieved: !!g.awarded, daysLeft };
    }
    return out;
  }

  static presentLevels(levels: { rank: number; min_spend_paise: string; reward_bps: number }[]) {
    return levels.map((l) => ({ rank: l.rank, name: LEVEL_NAMES[l.rank - 1], minSpendRupees: rupees(l.min_spend_paise), rewardPercent: l.reward_bps / 100 }));
  }

  // ------------------------------------------------------------------ owner side
  async overview(shopId: number) {
    const [features, cfg, levels, goals] = await Promise.all([
      this.features(this.db.pool, shopId), this.shops.getConfig(shopId),
      this.levels(this.db.pool, shopId), this.goalsWithProgress(this.db.pool, shopId, null),
    ]);
    return {
      features: { levels: features.levels, goals: features.goals },
      baseRewardPercent: cfg.reward_bps / 100,
      pointValueRupees: cfg.point_value_paise / 100,
      levels: PerksService.presentLevels(levels),
      goals: goals.map((g) => PerksService.presentGoal(g, false)),
    };
  }

  async saveLevels(shopId: number, userId: number, input: { rank: number; minSpendRupees: number; rewardPercent: number }[]) {
    const list = [...input].sort((a, b) => a.rank - b.rank);
    if (new Set(list.map((l) => l.rank)).size !== list.length) throw E.bad('BAD_LEVELS', 'Each level can be set only once');
    return this.db.tx(async (c) => {
      const cfg = await this.shops.getConfig(shopId, c);
      const base = cfg.reward_bps / 100;
      let prev: (typeof list)[number] | null = null;
      for (const l of list) {
        const name = LEVEL_NAMES[l.rank - 1];
        if (l.rewardPercent <= base) throw E.bad('BAD_LEVELS', `${name}: reward must be higher than your normal ${base}%`);
        if (l.rewardPercent > 50) throw E.bad('BAD_LEVELS', `${name}: reward cannot be more than 50%`);
        if (prev && l.minSpendRupees <= prev.minSpendRupees) throw E.bad('BAD_LEVELS', `${name}: spend must be more than ${LEVEL_NAMES[prev.rank - 1]}`);
        if (prev && l.rewardPercent <= prev.rewardPercent) throw E.bad('BAD_LEVELS', `${name}: reward must be higher than ${LEVEL_NAMES[prev.rank - 1]}`);
        prev = l;
      }
      await c.query('DELETE FROM shop_levels WHERE shop_id = $1', [shopId]);
      for (const l of list) {
        await c.query('INSERT INTO shop_levels (shop_id, rank, min_spend_paise, reward_bps) VALUES ($1,$2,$3,$4)',
          [shopId, l.rank, Math.round(l.minSpendRupees * 100), Math.round(l.rewardPercent * 100)]);
      }
      await this.shops.audit(c, userId, shopId, 'levels.update', 'shop', shopId, list);
      return { ok: true };
    });
  }

  async createGoal(shopId: number, userId: number, g: { kind: 'visits' | 'spend'; target: number; periodDays: number; bonusPoints: number }) {
    if (g.kind === 'visits' && (!Number.isInteger(g.target) || g.target < 2 || g.target > 100)) throw E.bad('BAD_GOAL', 'Visits: choose 2 to 100');
    if (g.kind === 'spend' && (g.target < 100 || g.target > 100_000_000)) throw E.bad('BAD_GOAL', 'Spend: at least ₹100');
    return this.db.tx(async (c) => {
      await c.query('SELECT id FROM shops WHERE id = $1 FOR UPDATE', [shopId]);
      const n = (await c.query('SELECT count(*)::int AS n FROM shop_goals WHERE shop_id = $1 AND active', [shopId])).rows[0].n;
      if (n >= 5) throw E.bad('TOO_MANY_GOALS', 'You can have up to 5 goals running. Stop one first.');
      const r = (await c.query(
        `INSERT INTO shop_goals (shop_id, kind, target, period_days, bonus_points, starts_on, created_by) VALUES ($1,$2,$3,$4,$5, ${IST_DATE}, $6) RETURNING id`,
        [shopId, g.kind, g.kind === 'visits' ? g.target : Math.round(g.target * 100), g.periodDays, g.bonusPoints, userId])).rows[0];
      await this.shops.audit(c, userId, shopId, 'goal.create', 'goal', r.id, g);
      return { id: Number(r.id) };
    });
  }

  async stopGoal(shopId: number, userId: number, goalId: number) {
    return this.db.tx(async (c) => {
      const r = await c.query('UPDATE shop_goals SET active = FALSE WHERE id = $1 AND shop_id = $2 AND active RETURNING id', [goalId, shopId]);
      if (!r.rowCount) throw E.notFound('Running goal');
      await this.shops.audit(c, userId, shopId, 'goal.stop', 'goal', goalId, null);
      return { ok: true };
    });
  }

  // ------------------------------------------------------------------ customer side
  /** Levels, goals and this customer's place in them at one shop. Null when the shop offers nothing (or its package does not include it). */
  async perksForShop(shopId: number, customerId: number | null) {
    const f = await this.features(this.db.pool, shopId);
    const levels = f.levels ? await this.levels(this.db.pool, shopId) : [];
    const goals = f.goals ? await this.goalsWithProgress(this.db.pool, shopId, customerId) : [];
    if (!levels.length && !goals.length) return null;
    let my: Record<string, unknown> | null = null;
    if (levels.length && customerId) {
      const spend = await this.spend12m(this.db.pool, shopId, customerId);
      const { current, next } = PerksService.levelFor(levels, spend);
      my = {
        spendRupees: rupees(spend),
        level: current ? { rank: current.rank, name: LEVEL_NAMES[current.rank - 1], rewardPercent: current.reward_bps / 100 } : null,
        next: next ? { rank: next.rank, name: LEVEL_NAMES[next.rank - 1], rewardPercent: next.reward_bps / 100, needRupees: rupees(Number(next.min_spend_paise) - spend), minSpendRupees: rupees(next.min_spend_paise) } : null,
      };
    }
    return {
      levels: PerksService.presentLevels(levels),
      goals: goals.map((g) => PerksService.presentGoal(g, !!customerId)),
      my,
    };
  }

  /**
   * Shops in the customer's city (plus any shop where they already have a card) that offer levels or goals.
   * Own shops first. Stops as soon as it has enough, so the home screen stays quick.
   */
  async rewards(userId: number, o: { limit: number; offset: number }) {
    const cust = (await this.db.pool.query('SELECT city FROM customers WHERE user_id = $1', [userId])).rows[0];
    const cands = (await this.db.pool.query(
      `SELECT s.id, s.name, s.logo_url, s.city, (w.customer_id IS NOT NULL) AS has_card
         FROM shops s LEFT JOIN wallets w ON w.shop_id = s.id AND w.customer_id = $1
        WHERE s.status = 'approved'
          AND (w.customer_id IS NOT NULL OR lower(s.city) = lower($2::text))
          AND (EXISTS (SELECT 1 FROM shop_levels l WHERE l.shop_id = s.id) OR EXISTS (SELECT 1 FROM shop_goals g WHERE g.shop_id = s.id AND g.active))
        ORDER BY (w.customer_id IS NOT NULL) DESC, lower(s.name), s.id
        LIMIT 120`, [userId, cust?.city ?? null])).rows;
    const items: Record<string, unknown>[] = [];
    let seen = 0;
    let hasMore = false;
    for (const s of cands) {
      const perks = await this.perksForShop(s.id, userId);
      if (!perks) continue;
      if (seen++ < o.offset) continue;
      if (items.length >= o.limit) { hasMore = true; break; }
      items.push({ shopId: Number(s.id), name: s.name, logoUrl: s.logo_url, city: s.city, hasCard: s.has_card, ...perks });
    }
    return { items, hasMore };
  }
}
