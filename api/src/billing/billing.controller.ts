import { Body, Controller, Get, Headers, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { AuthUser, CurrentShop, CurrentUser, Public, ShopCtx, ShopRoute } from '../common/auth';
import { parse } from '../common/util';
import { BillingService } from './billing.service';

/** Shop owner's plan, SMS packs and payments. Works even when the plan has expired (read-only). */
@Controller('shop/billing')
export class ShopBillingController {
  constructor(private billing: BillingService) {}

  @ShopRoute({ owner: true }) @Get()
  summary(@CurrentShop() s: ShopCtx) { return this.billing.summary(s.id); }

  @ShopRoute({ owner: true }) @Post('orders')
  order(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('plan'), planCode: z.string() }),
      z.object({ kind: z.literal('sms_pack'), packCode: z.string() }),
    ]), body);
    return this.billing.createOrder(s.id, u.id, b);
  }

  @ShopRoute({ owner: true }) @Post('verify')
  verify(@CurrentShop() s: ShopCtx, @Body() body: unknown) {
    return this.billing.verify(s.id, parse(z.object({ orderId: z.string().min(5), paymentId: z.string().min(3), signature: z.string().min(3) }), body));
  }
}

@Controller('billing')
export class BillingWebhookController {
  constructor(private billing: BillingService) {}

  /** Set this URL in Razorpay Dashboard › Webhooks: https://<api>/v1/billing/razorpay/webhook */
  @Public() @Post('razorpay/webhook')
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') sig?: string) {
    return this.billing.webhook(req.rawBody, sig);
  }
}
