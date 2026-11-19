# Mere Points

Multi-shop loyalty platform: building-material shops reward their regular customers (carpenters, painters, contractors…) with points they redeem at the same shop.

| Folder | What | Start here |
|---|---|---|
| `api/` | NestJS + PostgreSQL backend: points ledger, payouts, offers, billing (Razorpay), admin, background jobs | `api/README.md` |
| `app/` | Flutter app for Android + iOS: one app with customer / shop role switch | `app/README.md` |
| `web/` | Next.js: public website (`/`, `/terms`, `/privacy`, `/refunds`, `/delete-account`, `/contact`, `/get-started`) + Shop dashboard (`/merchant`) + Super Admin (`/admin`) | `web/README.md` |
| `deploy/`, `DEPLOY-AWS.md` | AWS setup (RDS, App Runner, S3 + CloudFront, Razorpay, SMS) | `DEPLOY-AWS.md` |

## Try everything on one computer

```bash
docker compose up --build      # db + api (:3000) + web (:3001)
```
or without Docker: start Postgres, then `cd api && npm install && npm run migrate && npm run dev`, then `npm run seed` for demo data, then `cd web && npm install && npm run dev`.

## CI

`.github/workflows/app.yml` runs on every push: API tests against Postgres, web type-check + build, Flutter analyze/test + Android APK + iOS compile, and Docker image builds. `deploy-aws.yml` deploys on demand.
