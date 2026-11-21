import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { parse } from '../common/util';
import { AuthService } from './auth.service';
import { E } from '../common/errors';
import { OAuth2Client } from 'google-auth-library';
import { config } from '../config';

let googleClient: OAuth2Client | null = null;
/** Checks the Google ID token's signature and audience (GOOGLE_CLIENT_IDS) with Google's public keys. */
export const googleVerifier = async (idToken: string): Promise<{ sub: string; email?: string; name?: string }> => {
  if (!config.googleClientIds.length) throw E.bad('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not switched on yet. Use mobile OTP or email.');
  googleClient ??= new OAuth2Client();
  const ticket = await googleClient.verifyIdToken({ idToken, audience: config.googleClientIds });
  const p = ticket.getPayload();
  if (!p?.sub || p.email_verified === false) throw E.bad('GOOGLE_FAILED', 'Google account email is not verified');
  return { sub: p.sub, email: p.email, name: p.name };
};

const email = z.string().trim().toLowerCase().email('Enter a valid email').max(120);
export const Password = z.string()
  .min(8, 'Password must be at least 8 characters').max(72, 'Password is too long')
  .regex(/[A-Za-z]/, 'Password needs at least one letter').regex(/\d/, 'Password needs at least one number');

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('otp')
  requestOtp(@Body() body: unknown) {
    const { mobile } = parse(z.object({ mobile: z.string() }), body);
    return this.auth.requestOtp(mobile);
  }

  @Public() @Post('verify')
  verify(@Body() body: unknown) {
    const b = parse(z.object({ mobile: z.string(), code: z.string().regex(/^\d{6}$/), linkToken: z.string().optional() }), body);
    return this.auth.verifyOtp(b.mobile, b.code, b.linkToken);
  }

  @Public() @Post('google')
  google(@Body() body: unknown) {
    const { idToken } = parse(z.object({ idToken: z.string().min(10) }), body);
    return this.auth.google(idToken, googleVerifier);
  }

  @Public() @Post('email/signup')
  emailSignup(@Body() body: unknown) {
    return this.auth.emailSignup(parse(z.object({ email, password: Password, mobile: z.string(), code: z.string().regex(/^\d{6}$/), name: z.string().trim().min(2).max(80).optional() }), body));
  }

  @Public() @Post('email/login')
  emailLogin(@Body() body: unknown) {
    return this.auth.emailLogin(parse(z.object({ email, password: z.string().min(1).max(72) }), body));
  }

  @Public() @Post('password/forgot')
  forgot(@Body() body: unknown) {
    return this.auth.forgotPassword(parse(z.object({ email }), body).email);
  }

  @Public() @Post('password/reset')
  reset(@Body() body: unknown) {
    return this.auth.resetPassword(parse(z.object({ email, code: z.string().regex(/^\d{6}$/), password: Password }), body));
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }
}
