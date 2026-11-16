import { Body, Controller, Get, Post } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser, Public } from '../common/auth';
import { parse } from '../common/util';
import { AuthService } from './auth.service';
import { E } from '../common/errors';

/** Replace with google-auth-library verifyIdToken in production. */
export const googleVerifier = async (_idToken: string): Promise<{ sub: string; email?: string; name?: string }> => {
  throw E.bad('GOOGLE_NOT_CONFIGURED', 'Google sign-in is not configured on this server');
};

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

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id);
  }
}
