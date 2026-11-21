import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../common/auth';
import { parse } from '../common/util';
import { CustomerService } from './customer.service';
import { RedeemService } from '../redeem/redeem.service';
import { ProductsService } from '../products/products.service';
import { AdsService } from '../ads/ads.service';

/** Work type code; the list lives in the professions table (editable by Super Admin). */
const profession = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/);

@Controller('me')
export class CustomerController {
  constructor(private customers: CustomerService, private redeem: RedeemService, private productsSvc: ProductsService, private ads: AdsService) {}

  @Post('customer')
  register(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.customers.register(u.id, parse(z.object({
      name: z.string().trim().min(2).max(80), profession: profession.optional(), professions: z.array(profession).min(1).max(3).optional(),
      city: z.string().trim().max(80).optional(), area: z.string().trim().max(120).optional(), state: z.string().trim().max(80).optional(),
      pincode: z.string().regex(/^\d{6}$/).optional(), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(),
      upiId: z.string().optional(), language: z.string().optional(), photoUrl: z.string().url().optional(),
    }), body));
  }

  @Patch('customer')
  settings(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.customers.updateSettings(u.id, parse(z.object({
      upiId: z.string().optional(), language: z.string().optional(), smsOnEarn: z.boolean().optional(),
      profession: profession.optional(), professions: z.array(profession).min(1).max(3).optional(), city: z.string().optional(), area: z.string().optional(),
    }), body));
  }

  /** Optional lat/lng: lets "near the shop" ads match where the customer is right now. */
  @Get('home')
  async home(@CurrentUser() u: AuthUser, @Query() q: any) {
    const loc = parse(z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }), q);
    const home = await this.customers.home(u.id);
    return { ...home, ads: await this.ads.feedFor(u.id, loc.lat, loc.lng) };
  }
  @Get('qr') qr(@CurrentUser() u: AuthUser) { return this.customers.qr(u.id); }

  @Get('cards/:shopId')
  card(@CurrentUser() u: AuthUser, @Param('shopId') shopId: string) { return this.customers.shopCard(u.id, Number(shopId)); }

  /** Home grid (6 at a time, Load more) and Explore › Products. */
  @Get('products')
  products(@CurrentUser() u: AuthUser, @Query() q: any) {
    const p = parse(z.object({
      kind: z.enum(['redeem', 'earn']).default('redeem'), scope: z.enum(['my', 'nearby']).default('my'),
      lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), km: z.coerce.number().positive().max(50).optional(),
      shopId: z.coerce.number().int().positive().optional(), category: z.string().max(40).optional(), search: z.string().trim().max(60).optional(),
      canTake: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), sort: z.enum(['points', 'new', 'near']).optional(),
      limit: z.coerce.number().int().min(1).max(60).default(6), offset: z.coerce.number().int().min(0).max(5000).default(0),
    }), q);
    return this.productsSvc.feed(u.id, p);
  }

  @Get('products/:id')
  product(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.productsSvc.detail(u.id, Number(id)); }

  /** Self-service deletion (Profile › Delete my account). Body: { confirm: "DELETE" }. */
  @Post('delete-account')
  deleteAccount(@CurrentUser() u: AuthUser, @Body() body: any) { return this.customers.deleteAccount(u.id, String(body?.confirm ?? '')); }

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
