# Vyapar Point web: Shop dashboard + Super Admin

One Next.js app, two portals, exported as static files (no server to run):

- **`/merchant/`**: shop owners and staff log in with mobile OTP. Counter (add points / pay out by mobile number or USB QR scanner), payouts, customers, transactions, products (gifts + earn-more bonus, photo upload), offers, Home-screen ad (book + pay + status), SMS, reports, staff, settings, plan & billing (Razorpay).
- **`/admin/`**: the Vyapar Point team logs in with username + password (locks for 15 min after 5 wrong tries). Also: Home ads (create, review shop requests, pause, shop ad prices) and Work types. Roles: **Owner** (everything), **Operations** (shops, approvals, SMS credits, plan extensions, analytics, payments), **Support** (disputes, customer lookup, read-only shops).

## Run locally

```bash
npm install
cp .env.example .env.local        # NEXT_PUBLIC_API_URL=http://localhost:3000/v1
npm run dev                       # http://localhost:3001
```

With the API running and demo data (`cd ../api && npm run seed`):
- Shop: mobile `9810000001`, the OTP is shown on screen in development
- Admin: `mohit` / `Vyapar-admin-2026`, or Support: `support1` / `Support-pass-2026`

## Build

```bash
NEXT_PUBLIC_API_URL=https://api.vyaparpoint.in/v1 npx next build   # → out/ (upload to S3, see ../DEPLOY-AWS.md)
```

Detail pages use query strings (`/admin/shop/?id=12`) so every page is a plain file.
