export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/merepoints',
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-change-me',
  jwtTtl: process.env.JWT_TTL ?? '30d',
  qrSecret: process.env.QR_SECRET ?? 'dev-qr-secret-change-me',
  otpSecret: process.env.OTP_SECRET ?? 'dev-otp-secret-change-me',
  /** Return OTP codes in API responses. Never true in production. */
  otpDevEcho: process.env.OTP_DEV_ECHO !== 'false' && process.env.NODE_ENV !== 'production',
  /** Business timezone for "today" in limits and daily stats. */
  timezone: 'Asia/Kolkata',
  qrWindowSeconds: 60,
  otpTtlSeconds: 300,
  otpMaxPerHour: 5,
  otpMaxAttempts: 5,
  maxGpsAccuracyM: 100,
  /** Google OAuth client IDs (web + Android + iOS), comma separated. Needed for Google sign-in. */
  googleClientIds: (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Firebase Cloud Messaging (phone push). Paste the service-account JSON (or leave empty: notifications still reach the in-app inbox). */
  fcm: { serviceAccountJson: process.env.FCM_SERVICE_ACCOUNT_JSON ?? '' },
  /** Notifications a shop may send per day (stops spamming Site Experts). */
  notificationsPerDay: Number(process.env.NOTIFICATIONS_PER_DAY ?? 5),
  /** Wrong passwords before an account waits {lockMinutes} minutes. */
  loginMaxFails: 5,
  loginLockMinutes: 15,
  /** Leave empty to run billing in test mode (no real money). */
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  /** This API's public address, used in links it hands out (local uploads). */
  publicApiUrl: process.env.PUBLIC_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}/v1`,
  uploads: {
    bucket: process.env.S3_BUCKET ?? '',
    region: process.env.AWS_REGION ?? 'ap-south-1',
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? '',
    localDir: process.env.UPLOADS_DIR ?? './uploads',
  },
  /** Web app origins allowed to call the API (comma separated). Empty = allow all (dev). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
