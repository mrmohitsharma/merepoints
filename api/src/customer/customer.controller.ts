import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/auth';
import { parse } from '../common/util';
import { CustomerService } from './customer.service';
import { RedeemService } from '../redeem/redeem.service';

const professions = ['carpenter', 'painter', 'interior_designer', 'contractor', 'architect', 'plumber', 'electrician', 'other'] as const;

@Controller('me')
export class CustomerController {
  constructor(private customers: CustomerService, private redeem: RedeemService) {}

  @Post('customer')
  register(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.customers.register(u.id, parse(z.object({
      name: z.string().trim().min(2).max(80), profession: z.enum(professions), city: z.string().optional(),
      upiId: z.string().optional(), language: z.string().optional(), photoUrl: z.string().url().optional(),
    }), body));
  }

  @Patch('customer')
  settings(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.customers.updateSettings(u.id, parse(z.object({
      upiId: z.string().optional(), language: z.string().optional(), smsOnEarn: z.boolean().optional(),
      profession: z.enum(professions).optional(), city: z.string().optional(),
    }), body));
  }

  @Get('home') home(@CurrentUser() u: AuthUser) { return this.customers.home(u.id); }
  @Get('qr') qr(@CurrentUser() u: AuthUser) { return this.customers.qr(u.id); }

  @Get('cards/:shopId')
  card(@CurrentUser() u: AuthUser, @Param('shopId') shopId: string) { return this.customers.shopCard(u.id, Number(shopId)); }

  @Get('history')
  history(@CurrentUser() u: AuthUser, @Query() q: any) {
    return this.customers.history(u.id, { shopId: q.shopId && Number(q.shopId), kind: q.kind, before: q.before, limit: q.limit && Number(q.limit) });
  }

  @Get('redemptions/pending')
  pending(@CurrentUser() u: AuthUser) { return this.redeem.pendingForCustomer(u.id); }

  /** The "Received" button. */
  @Post('redemptions/:id/received')
  received(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.redeem.confirmByCustomer(u.id, id); }

  /** The "Not received yet" button. */
  @Post('redemptions/:id/not-received')
  notReceived(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: any) {
    return this.redeem.dispute(u.id, id, typeof body?.note === 'string' ? body.note.slice(0, 200) : undefined);
  }
}

@Controller('discover')
export class DiscoverController {
  constructor(private customers: CustomerService) {}

  @Get('shops')
  nearby(@CurrentUser() u: AuthUser, @Query() q: any) {
    const p = parse(z.object({
      lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().positive().max(50).optional(),
      category: z.string().optional(), search: z.string().max(60).optional(), limit: z.coerce.number().int().positive().max(100).optional(),
    }), q);
    return this.customers.nearby(u.id, p);
  }

  @Get('shops/:id')
  shop(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.customers.publicShop(Number(id), u.id); }
}
