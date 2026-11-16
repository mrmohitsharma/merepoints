export const config = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/vyapar',
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
  /** Leave empty to run billing in test mode (no real money). */
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID ?? '',
    keySecret: process.env.RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
  },
  /** Web app origins allowed to call the API (comma separated). Empty = allow all (dev). */
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
};
