/**
 * Billing state, derived from dates every time (no cron to flip it), for a shop_subscriptions alias.
 *   trial / active : now <= end of trial or paid period
 *   grace          : up to grace_days after that (full access, reminders shown)
 *   read_only      : after grace — the paid package has ended and the shop is on the free package (nothing is locked, paid features switch off)
 *   free           : on a free package (price 0); no period to track
 */
export const billingStateSql = (ss: string) => `
  CASE
    WHEN ${ss}.shop_id IS NULL THEN 'free'
    WHEN EXISTS (SELECT 1 FROM plans fp WHERE fp.id = ${ss}.plan_id AND fp.price_paise = 0) THEN 'free'
    WHEN ${ss}.cancelled THEN 'read_only'
    WHEN now() <= COALESCE(${ss}.current_period_end, ${ss}.trial_ends_at)
      THEN CASE WHEN ${ss}.current_period_end IS NULL THEN 'trial' ELSE 'active' END
    WHEN now() <= COALESCE(${ss}.current_period_end, ${ss}.trial_ends_at)
                  + make_interval(days => (SELECT value::text::int FROM platform_settings WHERE key = 'grace_days'))
      THEN 'grace'
    ELSE 'read_only'
  END`;

export type BillingState = 'trial' | 'active' | 'grace' | 'read_only' | 'free';
