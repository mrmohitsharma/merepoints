# Deploying Mere Points on AWS (Mumbai region)

```
                     app.merepoints.in                         api.merepoints.in
 Shop & admin web ──► CloudFront ──► S3 (static files)    Phones & web ──► App Runner (API, Docker) ──► RDS PostgreSQL 16
                                                                              │  background jobs run inside
                                                                              └► Razorpay, SMS provider
```

| Piece | AWS service | Starting size |
|---|---|---|
| Database | RDS for PostgreSQL 16, `ap-south-1` | db.t4g.small, 20 GB gp3, 7-day backups |
| API | App Runner (from the `api/Dockerfile` image in ECR) | 1 vCPU / 2 GB, min 1, max 3 instances |
| Web dashboards | S3 + CloudFront | static files, no server |
| Secrets | App Runner environment (from Secrets Manager) | |

This is enough for the year-one target (1,000 shops). The load test handled 362 bills a second on one small server. Check current prices in the AWS Pricing Calculator for `ap-south-1` before you start.

## 1. Database (RDS)

1. RDS › Create database › PostgreSQL 16 › **Production** template off (Single-AZ is fine to start) › `db.t4g.small`.
2. Name `merepoints`, master user `merepoints`, generate a strong password and keep it.
3. Connectivity: **not publicly accessible**. Create a security group `merepoints-db` that allows port 5432 only from the App Runner VPC connector's security group (step 3).
4. Backups 7 days, deletion protection **on**.

The API creates all tables itself on first start (migrations), so you don't run any SQL by hand.

## 2. Push the API image (ECR)

1. ECR › Create repository `merepoints-api`.
2. Either push from your Mac:
   ```bash
   aws ecr get-login-password --region ap-south-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.ap-south-1.amazonaws.com
   docker build -t <account>.dkr.ecr.ap-south-1.amazonaws.com/merepoints-api:latest api
   docker push <account>.dkr.ecr.ap-south-1.amazonaws.com/merepoints-api:latest
   ```
   or use the **Deploy to AWS** GitHub workflow (step 6).

## 3. API service (App Runner)

1. App Runner › Create service › Container registry › ECR › `merepoints-api:latest`. Deployment: manual (the workflow triggers it).
2. Port **8080**. Health check: HTTP path `/v1/health`.
3. Networking › Outgoing traffic: **Custom VPC** › create a VPC connector in the RDS VPC's private subnets with security group `merepoints-apprunner` (allowed by `merepoints-db`).
   App Runner needs internet access too (Razorpay, SMS): put the connector in private subnets that have a **NAT gateway**.
4. Environment variables: copy `api/.env.example`. Store the secrets in Secrets Manager and reference them:
   - `DATABASE_URL=postgres://merepoints:<password>@<rds-endpoint>:5432/merepoints?sslmode=require`
   - `JWT_SECRET`, `QR_SECRET`, `OTP_SECRET`: each `openssl rand -base64 48`. The API refuses to start in production with weak ones.
   - `NODE_ENV=production`, `CORS_ORIGINS=https://app.merepoints.in`
   - First deploy only: `ADMIN_BOOTSTRAP_USERNAME`, `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_PASSWORD`. This creates your owner login. Change the password at first login, then remove these three variables.
5. Custom domain: add `api.merepoints.in` and create the DNS records App Runner shows.

**Background jobs** (sending SMS every 15 s, escalating unconfirmed payouts, nightly points expiry, plan-due reminders) run inside the API. With 2–3 instances only one runs each job at a time (database lock). Nothing else to schedule.

## 4. Web dashboards (S3 + CloudFront)

1. S3 › Create bucket `merepoints-web-<something>`, Block all public access **on**.
2. CloudFront › Create distribution › origin = that bucket with **Origin access control** (let CloudFront update the bucket policy).
   - Default root object `index.html`, Viewer protocol: Redirect HTTP to HTTPS.
   - Functions › create one from `deploy/cloudfront-index.js`, attach to *Viewer request*.
   - Alternate domain `app.merepoints.in` with an ACM certificate (requested in **us-east-1**, which CloudFront requires).
3. Build and upload (or use the workflow):
   ```bash
   cd web && NEXT_PUBLIC_API_URL=https://api.merepoints.in/v1 npx next build
   aws s3 sync out s3://merepoints-web-<something> --delete
   aws cloudfront create-invalidation --distribution-id <id> --paths "/*"
   ```
   Shop owners log in at `app.merepoints.in/merchant/`, your team at `app.merepoints.in/admin/`.

## 4b. Photo uploads (product photos, ad banners)

Phones and the web upload straight to S3 with a 10-minute signed link from the API; files are served by CloudFront.

1. S3 › Create bucket `merepoints-uploads-<something>` in ap-south-1, Block all public access **on**.
2. Bucket › Permissions › CORS:
   ```json
   [{ "AllowedMethods": ["PUT"], "AllowedOrigins": ["https://app.merepoints.in"], "AllowedHeaders": ["Content-Type", "Cache-Control"], "MaxAgeSeconds": 3000 }]
   ```
   (The Flutter app does not need CORS.)
3. CloudFront › new distribution with that bucket as origin (Origin access control), alternate domain `files.merepoints.in`, cache policy *CachingOptimized*.
4. App Runner's instance role: allow `s3:PutObject` on `arn:aws:s3:::merepoints-uploads-<something>/*`.
5. Environment: `S3_BUCKET`, `AWS_REGION=ap-south-1`, `S3_PUBLIC_BASE_URL=https://files.merepoints.in`. The API refuses to start in production without `S3_BUCKET`.

Limits: JPG/PNG/WebP, 2 MB. Keys look like `product/2026-11-19/u42-<random>.jpg`. Without `S3_BUCKET` (development) files are kept in `api/uploads/`.

## 5. Razorpay

1. Razorpay Dashboard › Settings › API keys › generate **live** keys → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` on App Runner.
2. Webhooks › add `https://api.merepoints.in/v1/billing/razorpay/webhook`, events `payment.captured` and `order.paid`, set a secret → `RAZORPAY_WEBHOOK_SECRET`. The webhook catches payments where the owner closed the browser before returning.
3. Prices are set in Super Admin › Plans & SMS packs. Shop ad prices: Super Admin › Home ads › Shop ad prices.
4. Shop ad payments use the same keys and webhook. If an ad is rejected after payment, refund it from the Razorpay dashboard (the shop is told by SMS).

Without keys the API runs billing in **test mode** in development, and in production refuses to take payments with a clear message.

## 6. One-click deploys from GitHub (optional)

1. IAM › Identity providers › add `token.actions.githubusercontent.com` (OpenID Connect).
2. Create a role `merepoints-github-deploy` trusted by your repo, with permissions: ECR push to `merepoints-api`, `apprunner:StartDeployment` on the service, S3 write to the web bucket, `cloudfront:CreateInvalidation`.
3. Repo › Settings › Variables: `AWS_DEPLOY_ROLE_ARN`, `APPRUNNER_SERVICE_ARN`, `WEB_BUCKET`, `CLOUDFRONT_ID`, `PUBLIC_API_URL=https://api.merepoints.in/v1`.
4. Actions › **Deploy to AWS** › Run (api, web or both).

## 7. SMS (before launch)

Indian SMS needs **DLT registration** (sender ID like `MRPNTS` and each message template approved on a DLT portal). The templates are in `api/src/sms/sms.service.ts`. Register them as written, then connect a provider (MSG91, Gupshup or Kaleyra) in `deliverBatch()`. Until then, messages queue in the `sms_outbox` table.

## 8. Mobile apps

Build with the production API:
```bash
cd app
flutter build appbundle --release --dart-define=API_URL=https://api.merepoints.in/v1   # Play Store
flutter build ipa --release --dart-define=API_URL=https://api.merepoints.in/v1         # App Store (Mac)
```

## Checklist before going live

- [ ] RDS deletion protection on, backups 7 days, not public
- [ ] Strong `JWT_SECRET`, `QR_SECRET`, `OTP_SECRET`; `NODE_ENV=production`
- [ ] `ADMIN_BOOTSTRAP_*` removed after first login; owner password changed
- [ ] `CORS_ORIGINS` set to the web domain only
- [ ] Razorpay live keys and webhook secret set; test one ₹1 plan
- [ ] SMS DLT templates approved and provider connected (includes `ad_approved` / `ad_rejected`)
- [ ] Uploads bucket private, CloudFront `files.` domain working, `S3_BUCKET` set
- [ ] CloudWatch alarm on App Runner 5xx errors and RDS CPU/free storage

## Phone push notifications (Firebase, optional)

Notifications always reach the in-app inbox. To also show them on the phone when the app is closed:

1. Create a free project at console.firebase.google.com and add an Android app with id `com.merepoints.mere_points` (and an iOS app if you ship to iPhone; upload your APNs key under Project settings > Cloud Messaging).
2. API: Project settings > Service accounts > Generate new private key. Put the whole JSON, on one line, in `FCM_SERVICE_ACCOUNT_JSON`.
3. App: build with `--dart-define=FIREBASE_API_KEY=... --dart-define=FIREBASE_APP_ID=... --dart-define=FIREBASE_SENDER_ID=... --dart-define=FIREBASE_PROJECT_ID=...` (values are in Project settings > Your apps). No google-services.json file is needed.
4. iPhone only: in Xcode, enable the Push Notifications capability and Background Modes > Remote notifications on the Runner target.

Shops can send up to `NOTIFICATIONS_PER_DAY` (default 5) notifications a day.
