# Vyapar Point

Multi-shop loyalty platform: shops reward their regular customers (carpenters, painters, contractors…) with points they redeem at the same shop.

- `api/`: NestJS + PostgreSQL backend (points ledger, redemptions, offers, reports, admin). See `api/README.md`.
- `app/`: Flutter app for Android and iOS, one app with a customer/shop role switch. See `app/README.md`.
- `.github/workflows/app.yml`: CI that tests the API against Postgres, analyzes and tests the app, builds the Android APK and compiles iOS.

Quick start: start Postgres, then `cd api && npm install && npm run migrate && npm run dev`, then `cd app && ./setup.sh && flutter run`.
