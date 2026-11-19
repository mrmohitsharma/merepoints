# Mere Points API

Backend for Mere Points: one Flutter app with a role switch (Customer / Shop owner / Staff) plus a Super Admin web console.
NestJS + PostgreSQL 16, raw SQL (no ORM) so every hot query is hand-written and index-backed.

## Run it

```bash
npm install
createdb merepoints && createdb merepoints_test        # PostgreSQL 14+ (needs btree_gist, citext — both ship with Postgres)
npm run migrate                                 # DATABASE_URL=postgres://... (default: local merepoints)
npm run dev                                     # http://localhost:3000/v1
npm test                                        # 30 end-to-end tests against merepoints_test (resets it)
```

Env: `DATABASE_URL`, `JWT_SECRET`, `QR_SECRET`, `OTP_SECRET` (all required in production), `OTP_DEV_ECHO=false` in production.

## Core design

**Money and points are integers.** Paise for rupees, basis points for % (500 = 5%), x100 for multipliers (150 = 1.5x). No floats anywhere in the money path.

**Ledger first.** `ledger_entries` is append-only. Every change to a balance writes a ledger row in the same transaction. Wallet balances are a cache of the ledger, and the tests assert after every suite that, for every wallet:
`balance = sum(open lots) = sum(ledger points)` and `held = sum(open redemptions)`.

**Point lots.** Each earn creates a lot with its own point value and expiry. Redemptions take lots oldest-expiry-first. This gives you, for free:
- A shop can change ₹ per point and old points keep the value they had when earned.
- Expiry is per earn, not per customer.
- Cancelling a redemption puts back exactly the lots it took.

**Isolation.** One wallet per (customer, shop). Every shop query binds `shop_id` from the authenticated membership (`X-Shop-Id` + `shop_members` check), never from the request body. Points cannot move between shops.

**Concurrency.** READ COMMITTED + explicit row locks in one fixed order (wallet → customer → lots → gift → daily stats), automatic retry on deadlock. Proven by tests: 12 parallel bills lose no update; 10 parallel redemptions of the same points → exactly 1 wins; 5 parallel manual adds against a 500/day staff limit → exactly 3 pass.

**Database-enforced rules** (cannot be bypassed by a bug in the app):
| Rule | How |
|---|---|
| Same invoice can't earn twice | partial unique index `bills (shop_id, lower(invoice_no)) WHERE NOT reversed` |
| One offer at a time per shop | `EXCLUDE USING gist (shop_id WITH =, period WITH &&)` |
| One open redemption per customer per shop | partial unique index on status in (held, paid, disputed) |
| An entry can be reversed once | unique index on `reverses_id` |
| Balances never negative | `CHECK (balance_points >= 0)` |

**Retries are safe.** `Idempotency-Key` header on add-points: a phone that retries on a bad network gets the same answer and no double points.

**SMS outbox.** SMS rows are written inside the business transaction and delivered by a worker (`SKIP LOCKED`), so a provider outage never loses or double-sends a message. Plug in MSG91 / Gupshup with DLT template IDs in `sms.service.ts`.

## Business flows

**Earn (bill):** points = floor(bill × shop % × live offer multiplier), capped at the shop's max per bill. The bill records the config version and offer used, so later changes never rewrite history.

**Redeem (your "Received" rule):**
```
held ──shop pays cash/UPI or hands gift──▶ paid ──customer taps Received (or shop enters SMS OTP)──▶ confirmed
 │                                           └─ customer taps Not received / 24 h no reply ─▶ disputed ─▶ admin confirms or cancels
 └─ shop cancels before paying ─▶ cancelled (exact lots returned)
```
Points leave the balance at *held* (can't be spent twice) and count as redeemed only at *confirmed*. UPI redemptions return a `upi://pay` deep link with payee and amount filled in.

**Reverse:** staff can reverse their own entry within 15 min (setting), the owner any time, but only if none of those points were used yet. Reversal frees the invoice number.

**Milestones:** admin-defined levels (name, threshold, colour, perks). Basis is a platform setting: points earned, or rupee value earned (fairer now that shops set different point values). The customer home returns exactly 3 tiles: last crossed, next with progress, the one after. Earn responses return `milestoneCrossed` so the app shows the level-up screen.

**Customer QR:** `VP1.<id>.<minute>.<hmac>` rotates every 60 s with no database write; screenshots stop working after about 2 minutes.

## Query performance (measured)

Seeded at the year-1 target: 1,000 shops, 1,00,000 customers, 2,97,000 wallets, 14,85,000 ledger rows (`perf/seed-scale.sql`).

| Hot query | Plan | Time |
|---|---|---|
| Customer home (all shop cards, offers, expiring) | PK + `point_lots_open_fifo` | 0.13 ms |
| Customer history page (keyset) | `ledger_customer_time` | 0.14 ms |
| Shop transactions page, busiest shop | `ledger_shop_time` | 0.56 ms |
| Shop customer list by points | `wallets_shop_balance` | 0.61 ms |
| FIFO lot pick for redeem | `point_lots_open_fifo` | 0.16 ms |
| "You owe customers ₹X" | index-only `point_lots_shop_open` | 1.4 ms |
| Staff manual-limit check | `ledger_staff_manual` (partial) | 0.06 ms |
| 30-day dashboard | `shop_daily_stats` PK (30 rows) | 0.27 ms |
| Nearby shops 5 km | `shops_geo_approved` bbox | 0.12 ms |

Load test (`perf/load-earn.ts`): 3,000 add-points requests at 40 concurrent → **362/sec, p95 163 ms, 0 failures**, on one small dev container. 1,000 shops at peak need about 3/sec. All wallets still matched their lots afterwards.

Pagination is keyset (`before=<timestamp>_<id>`), never OFFSET on the ledger. Dashboards read `shop_daily_stats` (updated in the same transaction), not the ledger.

**When to change the design:** past ~10,000 shops or ~50M ledger rows, partition `ledger_entries` by month (every query already filters by shop or customer + time), add a read replica for reports, and move nearby search to PostGIS.

## API (prefix /v1, Bearer token; shop routes need `X-Shop-Id`)

| Area | Endpoints |
|---|---|
| Auth | `POST auth/otp`, `POST auth/verify`, `POST auth/google`, `GET auth/me` (returns roles for the switch) |
| Shop sign-up | `GET shops/categories`, `POST shops` (details + categories + GPS ≤100 m + loyalty rules) |
| Shop profile & rules | `GET/PATCH shop`, `GET/PUT shop/config` (new version each save) |
| Staff | `GET/POST shop/staff`, `PATCH shop/staff/:userId` |
| Counter | `POST shop/customers/resolve` (QR or mobile), `POST shop/customers` (quick add) |
| Points | `POST shop/points/bill`, `POST shop/points/manual`, `POST shop/points/:entryId/reverse`, `GET shop/transactions` |
| Redeem | `POST shop/redemptions`, `…/:id/paid`, `…/:id/verify-otp`, `…/:id/cancel`, `GET shop/redemptions` |
| Offers | `GET/POST shop/offers`, `POST shop/offers/:id/cancel` |
| Products | `GET shop/products?kind=redeem|earn`, `POST shop/products` (create/update, both kinds), `GET shop/products/bonus` (counter list); `GET/POST shop/gifts` kept for older apps |
| Customer products | `GET me/products?kind&scope=my|nearby&lat&lng&km&category&search&canTake&sort&limit&offset` (with `categories` + `summary` on the first page), `GET me/products/:id` |
| Ads | `GET me/home?lat&lng` returns `ads` (max 6); `POST me/ads/events`; shop: `GET shop/ads/packs`, `GET/POST shop/ads`, `POST shop/ads/:id/pay`, `POST shop/ads/:id/cancel`; admin: `GET admin/ads?phase`, `GET admin/ads/counts`, `POST admin/ads`, `POST admin/ads/:id/review|pause`, `POST admin/ads/audience`, `GET/POST admin/ads/packs` |
| Uploads | `POST uploads` / `POST admin/uploads` → signed PUT link (S3, or local in development), `GET files/*` (development) |
| Work types | `GET shops/professions` (public), `GET/POST admin/professions` |
| SMS | `GET shop/messages/count?segment=`, `POST shop/messages` |
| Reports | `GET shop/reports/dashboard|daily|top-customers|staff`, `GET shop/reports/transactions.csv` |
| Customer | `POST/PATCH me/customer`, `GET me/home`, `GET me/qr`, `GET me/cards/:shopId`, `GET me/history` |
| Received | `GET me/redemptions/pending`, `POST me/redemptions/:id/received`, `POST me/redemptions/:id/not-received` |
| Discover | `GET discover/shops?lat&lng&radiusKm&category&search`, `GET discover/shops/:id` |
| Super admin | `GET admin/stats|shops|disputes|milestones|audit`, `POST admin/shops/:id/status`, `POST admin/shops/:id/sms-credits`, `POST admin/redemptions/:id/resolve`, `POST admin/milestones`, `PUT admin/milestones/basis`, jobs |

Errors are always `{ code, message }` with stable codes (`DUPLICATE_INVOICE`, `OFFER_OVERLAP`, `MANUAL_LIMIT`, `NOT_ENOUGH_POINTS`, …) so the app can show them in the user's language.

## Not done yet (stubs to plug in)

- **SMS provider** (MSG91/Gupshup + DLT templates): outbox and worker are ready.
- **Google sign-in token check** (`google-auth-library`): flow is built, verifier is a stub.
- **UPI name check** (VPA validation via Razorpay/Cashfree): column `upi_verified_name` ready.
- **Push notifications** (FCM) for the Received popup: the app can poll `me/redemptions/pending` meanwhile.
- **Scheduler**: run `admin/jobs/expire-points` nightly, `escalate-redemptions` hourly and `send-sms` every few seconds (or a worker loop).
- **Rate limiting** at the gateway (OTP is already capped at 5/hour/number in the DB).

## Admin, billing and jobs (v1.1)

- **Super Admin login** is username + password (`/v1/admin/auth/login`), separate from OTP app logins. Roles `owner`, `ops`, `support`. 5 wrong passwords lock for 15 minutes. Changing or resetting a password, or deactivating an admin, ends their sessions.
  First owner: set `ADMIN_BOOTSTRAP_USERNAME/NAME/PASSWORD` on first start, or `ADMIN_PASSWORD=... npm run create-admin -- mohit "Mohit Sharma" owner`.
- **Billing**: plans + SMS packs (`migrations/002_admin_billing.sql`, prices editable in admin). Approval starts a free trial. State is computed from dates: `trial`/`active` → `grace` (7 days, reminders) → `read_only` (no new points, customers, offers or SMS; **payouts still work**). Razorpay orders, signature check and webhook; exactly-once payment apply. Test mode without keys (development only).
- **Staff limit** follows the plan.
- **Background jobs** run in the API with Postgres advisory locks (safe with several servers): SMS sending, payout escalation, points expiry, plan reminders. `RUN_JOBS=true|false`, on by default in production.
- **Demo data**: `npm run seed` (API running in development).
- Tests: see below (`npm test`).

## Products, ads and work types (v1.3)

- **Products** (`migrations/004_products_worktypes.sql`): the old `gifts` table became `products` with `kind`:
  - `redeem`: gift for points (points cost, stock). Unchanged redeem flow.
  - `earn`: "earn more" item with fixed `bonus_points` per unit. At the counter `POST shop/points/bill` takes `items: [{productId, qty}]`; the bonus is added **on top**: no offer multiplier, outside the per-bill cap. Stored in `bills.bonus_points` + `bill_items`; one ledger entry for bill + bonus, so reversing the bill takes back both.
- **Customer feed**: Home shows 6 at a time ("Load more" = next offset). Explore › Products has My shops / Nearby, categories, "can take now". Redeem items the customer can take sort first. Product detail says "N more points ≈ ₹X of shopping" at the shop's lowest rate.
- **Ads** (`migrations/005_ads.sql`): Super Admin creates ads (brand / shop / Mere Points), or a shop requests one, pays by Razorpay (`payment_kind 'ad'`) and admin approves or rejects (SMS to owner). Targeting: everyone, cities, or near a shop (live location if the app sends it, else same city / existing card), plus work types. Live = approved and inside the dates; approving late keeps the paid number of days. Views/taps per day in `ad_daily_stats`.
- **Work types** are a table (`professions`), editable in Super Admin. Added: mason, tile fitter, POP / false ceiling, welder / fabricator, kitchen / wardrobe installer, builder / site supervisor.
- **Uploads**: presigned S3 PUT (JPG/PNG/WebP, 2 MB). Development without `S3_BUCKET` stores files in `api/uploads/`.
- Tests: 63 (`npm test`).
