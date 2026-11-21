import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminCtx, AdminOnly, AuthUser, CurrentAdmin, CurrentShop, CurrentUser, ShopCtx, ShopRoute } from '../common/auth';
import { parse } from '../common/util';
import { AdminAdInput, AdsService, ShopAdInput } from './ads.service';
import { ProductsService } from '../products/products.service';

const ids = z.array(z.number().int().positive()).max(20).optional();

/** Customer app: carousel events. The ads themselves come with GET me/home. */
@Controller('me/ads')
export class CustomerAdsController {
  constructor(private ads: AdsService) {}

  @Post('events')
  events(@CurrentUser() _u: AuthUser, @Body() body: unknown) {
    return this.ads.record(parse(z.object({ views: ids, taps: ids }), body));
  }
}

/** Shop owner: request a home-screen ad, pay online, wait for approval. */
@Controller('shop/ads')
export class ShopAdsController {
  constructor(private ads: AdsService) {}

  @ShopRoute({ owner: true, feature: 'ads' }) @Get('packs') packs() { return this.ads.packs(); }

  @ShopRoute({ owner: true, feature: 'ads' }) @Get()
  list(@CurrentShop() s: ShopCtx) { return this.ads.shopList(s.id); }

  @ShopRoute({ owner: true, writes: true, feature: 'ads' }) @Post()
  request(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.ads.shopRequest(s.id, u.id, parse(ShopAdInput, body));
  }

  /** Returns a Cashfree order; finish with POST shop/billing/verify like plans. */
  @ShopRoute({ owner: true, feature: 'ads' }) @Post(':id/pay')
  pay(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.ads.shopPay(s.id, u.id, Number(id)); }

  @ShopRoute({ owner: true, feature: 'ads' }) @Post(':id/cancel')
  cancel(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) { return this.ads.shopCancel(s.id, u.id, Number(id)); }
}

@Controller('admin/ads')
export class AdminAdsController {
  constructor(private ads: AdsService, private products: ProductsService) {}

  @AdminOnly() @Get()
  list(@Query('phase') phase?: string) { return this.ads.adminList(phase); }

  @AdminOnly() @Get('counts') counts() { return this.ads.adminCounts(); }

  @AdminOnly('owner', 'ops') @Get('packs') packs() { return this.ads.adminPacks(); }

  @AdminOnly('owner') @Post('packs')
  upsertPack(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.ads.upsertPack(a.id, parse(z.object({
      code: z.string().regex(/^[a-z0-9_]{2,20}$/), name: z.string().min(2).max(40), days: z.number().int().min(1).max(90),
      priceRupees: z.number().min(0).max(1_000_000), radiusKm: z.number().int().min(1).max(50).optional(), active: z.boolean().optional(), sort: z.number().int().optional(),
    }), body));
  }

  @AdminOnly() @Post('audience')
  audience(@Body() body: unknown) {
    return this.ads.audience(parse(z.object({
      mode: z.enum(['all', 'cities', 'near_shop']), cities: z.array(z.string()).max(30).optional(), shopId: z.number().int().positive().optional(),
      radiusKm: z.number().int().optional(), professions: z.array(z.string()).max(20).nullable().optional(),
    }), body));
  }

  /** Product picker on the ad form ("tap opens a product"). */
  @AdminOnly() @Get('shop-products/:shopId')
  shopProducts(@Param('shopId') shopId: string) { return this.products.list(Number(shopId)); }

  @AdminOnly() @Get(':id') stats(@Param('id') id: string) { return this.ads.adminStats(Number(id)); }

  @AdminOnly('owner', 'ops') @Post()
  upsert(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) { return this.ads.adminUpsert(a.id, parse(AdminAdInput, body)); }

  @AdminOnly('owner', 'ops') @Post(':id/review')
  review(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.ads.adminReview(a.id, Number(id), parse(z.object({ approve: z.boolean(), reason: z.string().max(200).optional(), sort: z.number().int().optional() }), body));
  }

  @AdminOnly('owner', 'ops') @Post(':id/pause')
  pause(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.ads.adminSetPaused(a.id, Number(id), parse(z.object({ paused: z.boolean() }), body).paused);
  }
}
