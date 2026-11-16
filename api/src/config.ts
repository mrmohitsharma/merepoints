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
};
