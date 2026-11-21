import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentShop, CurrentUser, Public, ShopCtx, ShopRoute } from '../common/auth';
import { Db } from '../db/db.service';
import { parse } from '../common/util';
import { LoyaltyConfigInput, RegisterShopInput, ShopService } from './shop.service';
import { PointsService } from '../points/points.service';
import { RedeemService } from '../redeem/redeem.service';
import { OffersService, Segment } from '../offers/offers.service';
import { ReportsService } from '../reports/reports.service';
import { ProductInput, ProductsService } from '../products/products.service';

/** Work type code; the list lives in the professions table (editable by Super Admin). */
const profession = z.string().regex(/^[a-z][a-z0-9_]{1,29}$/);

@Controller('shops')
export class ShopRegisterController {
  constructor(private shops: ShopService, private db: Db) {}

  /** Sign-up steps 1–4 submit together. Shop starts as 'pending' until a super admin approves. */
  @Post()
  register(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.shops.register(u.id, parse(RegisterShopInput, body));
  }

  @Public() @Get('categories')
  categories() {
    return this.db.many('SELECT code, name FROM categories WHERE active ORDER BY sort');
  }

  /** Public pricing for the website: active plans, SMS packs, free-trial length. */
  @Public() @Get('plans')
  async plans() {
    const [plans, packs, trial] = await Promise.all([
      this.db.many(`SELECT code, name, price_paise / 100 AS price_rupees, max_staff, sms_included, features FROM plans WHERE active ORDER BY sort`),
      this.db.many(`SELECT sms_count, price_paise / 100 AS price_rupees FROM sms_packs WHERE active ORDER BY sms_count`),
      this.db.one(`SELECT value FROM platform_settings WHERE key = 'trial_days'`).catch(() => null),
    ]);
    return { plans, smsPacks: packs, trialDays: Number(trial?.value ?? 30) };
  }

  /** Work types for sign-up pickers and offer targeting. Editable by Super Admin. */
  @Public() @Get('professions')
  professions() {
    return this.db.many(`SELECT code, name, name_hi AS "nameHi", icon FROM professions WHERE active ORDER BY sort, name`);
  }
}

/** Everything below needs header X-Shop-Id. */
@Controller('shop')
export class ShopController {
  constructor(
    private shops: ShopService, private points: PointsService, private redeem: RedeemService,
    private offers: OffersService, private reports: ReportsService, private productsSvc: ProductsService,
  ) {}

  // ---------------------------------------------------------------- profile & settings
  @ShopRoute({ allowPending: true }) @Get()
  async profile(@CurrentShop() s: ShopCtx) {
    const p = await this.shops.profile(s.id);
    const cfg = await this.shops.getConfig(s.id);
    return { ...p, me: { role: s.role, canAddPoints: s.canAddPoints, canRedeem: s.canRedeem, canManual: s.canManual }, billing: s.billing, loyalty: ShopService.presentConfig(cfg) };
  }

  @ShopRoute({ owner: true, allowPending: true }) @Patch()
  updateProfile(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.shops.updateProfile(s.id, u.id, parse(z.object({
      name: z.string().min(2).optional(), logoUrl: z.string().url().optional(), email: z.string().email().optional(), phone: z.string().optional(),
      openingHours: z.record(z.string(), z.string()).optional(), addressLine: z.string().optional(), landmark: z.string().optional(),
      brandsNote: z.string().optional(), categories: z.array(z.string()).optional(),
    }), body));
  }

  @ShopRoute({ allowPending: true }) @Get('config')
  async config(@CurrentShop() s: ShopCtx) {
    return ShopService.presentConfig(await this.shops.getConfig(s.id));
  }

  @ShopRoute({ owner: true, allowPending: true }) @Get('config/history')
  configHistory(@CurrentShop() s: ShopCtx) { return this.shops.configHistory(s.id); }

  @ShopRoute({ owner: true, allowPending: true }) @Put('config')
  updateConfig(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.shops.updateConfig(s.id, u.id, parse(LoyaltyConfigInput, body));
  }

  // ---------------------------------------------------------------- staff
  @ShopRoute({ owner: true }) @Get('staff')
  staff(@CurrentShop() s: ShopCtx) { return this.shops.listStaff(s.id); }

  @ShopRoute({ owner: true }) @Post('staff')
  addStaff(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.shops.addStaff(s.id, u.id, parse(z.object({
      mobile: z.string(), name: z.string().min(2), canRedeem: z.boolean().optional(), canManual: z.boolean().optional(), manualDailyLimit: z.number().int().min(0).optional(),
    }), body));
  }

  @ShopRoute({ owner: true }) @Patch('staff/:userId')
  updateStaff(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('userId') userId: string, @Body() body: unknown) {
    return this.shops.updateStaff(s.id, u.id, Number(userId), parse(z.object({
      active: z.boolean().optional(), canAddPoints: z.boolean().optional(), canRedeem: z.boolean().optional(), canManual: z.boolean().optional(), manualDailyLimit: z.number().int().min(0).optional(),
    }), body));
  }

  // ---------------------------------------------------------------- counter: find / add customer
  @ShopRoute() @Post('customers/resolve')
  resolve(@CurrentShop() s: ShopCtx, @Body() body: unknown) {
    return this.points.resolveCustomer(s.id, parse(z.object({ qr: z.string().optional(), mobile: z.string().optional() }), body));
  }

  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post('customers')
  quickAdd(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.points.quickAddCustomer(s.id, u.id, parse(z.object({
      mobile: z.string(), name: z.string().min(2), profession: profession.optional(), upiId: z.string().optional(), city: z.string().optional(),
    }), body));
  }

  @ShopRoute() @Get('customers')
  customers(@CurrentShop() s: ShopCtx, @Query() q: any) {
    return this.reports.customers(s.id, { search: q.search, profession: q.profession, sort: q.sort, limit: q.limit && Number(q.limit), offset: q.offset && Number(q.offset) });
  }

  @ShopRoute() @Get('customers/:id')
  customer(@CurrentShop() s: ShopCtx, @Param('id') id: string) {
    return this.reports.customerDetail(s.id, Number(id));
  }

  /** Owner can stop a customer from earning or redeeming at this shop (e.g. suspected misuse). */
  @ShopRoute({ owner: true }) @Post('customers/:id/block')
  block(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ blocked: z.boolean(), reason: z.string().max(200).optional() }), body);
    return this.shops.setCustomerBlocked(s.id, u.id, Number(id), b.blocked, b.reason);
  }

  // ---------------------------------------------------------------- earn & reverse
  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post('points/bill')
  earnBill(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.points.earnBill(s, u.id, parse(z.object({
      customerId: z.number().int().positive(), amountRupees: z.number().positive().max(10_000_000),
      invoiceNo: z.string().max(40).optional(), photoUrl: z.string().url().optional(), photoUrls: z.array(z.string().url().max(500)).max(3).optional(),
      items: z.array(z.object({ productId: z.number().int().positive(), qty: z.number().int().min(1).max(10_000) })).max(30).optional(),
    }), body), key);
  }

  @ShopRoute({ perm: 'canManual', writes: true }) @Post('points/manual')
  earnManual(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.points.earnManual(s, u.id, parse(z.object({
      customerId: z.number().int().positive(), points: z.number().int().positive().max(100_000),
      reason: z.enum(['festival_bonus', 'referral', 'missed_bill', 'correction', 'other']), remarks: z.string().max(200).optional(), invoiceNo: z.string().max(40).optional(),
    }), body), key);
  }

  @ShopRoute({ perm: 'canAddPoints' }) @Post('points/:entryId/reverse')
  reverse(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('entryId') entryId: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().min(3).max(200) }), body);
    return this.points.reverse(s, u.id, entryId, reason);
  }

  @ShopRoute() @Get('transactions')
  transactions(@CurrentShop() s: ShopCtx, @Query() q: any) {
    return this.reports.ledger(s.id, {
      customerId: q.customerId && Number(q.customerId), types: q.types ? String(q.types).split(',') : undefined,
      from: q.from, to: q.to, before: q.before, limit: q.limit && Math.min(Number(q.limit), 200),
    });
  }

  // ---------------------------------------------------------------- redeem
  @ShopRoute({ perm: 'canRedeem' }) @Post('redemptions')
  createRedemption(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.redeem.create(s, u.id, parse(z.object({
      customerId: z.number().int().positive(), method: z.enum(['cash', 'upi', 'gift']),
      points: z.number().int().positive().optional(), giftId: z.number().int().positive().optional(),
    }), body));
  }

  @ShopRoute({ perm: 'canRedeem' }) @Post('redemptions/:id/paid')
  markPaid(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { paymentRef } = parse(z.object({ paymentRef: z.string().max(60).optional() }), body);
    return this.redeem.markPaid(s, u.id, id, paymentRef);
  }

  @ShopRoute({ perm: 'canRedeem' }) @Post('redemptions/:id/verify-otp')
  verifyOtp(@CurrentShop() s: ShopCtx, @Param('id') id: string, @Body() body: unknown) {
    const { code } = parse(z.object({ code: z.string().regex(/^\d{4}$/) }), body);
    return this.redeem.confirmByOtp(s, id, code);
  }

  @ShopRoute({ perm: 'canRedeem' }) @Post('redemptions/:id/cancel')
  cancel(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.redeem.cancelByShop(s, u.id, id);
  }

  @ShopRoute() @Get('redemptions/:id')
  redemption(@CurrentShop() s: ShopCtx, @Param('id') id: string) {
    return this.redeem.getForShop(s.id, id);
  }

  @ShopRoute() @Get('redemptions')
  redemptions(@CurrentShop() s: ShopCtx, @Query('status') status?: string) {
    return this.redeem.listForShop(s.id, status ? status.split(',') : ['held', 'paid', 'disputed']);
  }

  // ---------------------------------------------------------------- offers, gifts, SMS (owner)
  @ShopRoute() @Get('offers')
  listOffers(@CurrentShop() s: ShopCtx) { return this.offers.listOffers(s.id); }

  @ShopRoute({ owner: true, writes: true }) @Post('offers')
  createOffer(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.offers.createOffer(s.id, u.id, parse(z.object({
      name: z.string().min(2).max(60), multiplier: z.number(), startsAt: z.string().datetime({ offset: true }), endsAt: z.string().datetime({ offset: true }),
      professions: z.array(profession).nullable().optional(),
    }), body));
  }

  @ShopRoute({ owner: true }) @Post('offers/:id/cancel')
  cancelOffer(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.offers.cancelOffer(s.id, u.id, Number(id));
  }

  @ShopRoute() @Get('gifts')
  gifts(@CurrentShop() s: ShopCtx) { return this.offers.listGifts(s.id); }

  @ShopRoute({ owner: true }) @Post('gifts')
  upsertGift(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.offers.upsertGift(s.id, u.id, parse(z.object({
      id: z.number().int().optional(), name: z.string().min(2).max(60), pointsCost: z.number().int().positive(), stock: z.number().int().min(0),
      photoUrl: z.string().url().optional(), availableUntil: z.string().nullable().optional(), visible: z.boolean().optional(), active: z.boolean().optional(),
    }), body));
  }

  // ---------------------------------------------------------------- products (redeem + earn more)
  @ShopRoute() @Get('products')
  products(@CurrentShop() s: ShopCtx, @Query('kind') kind?: string) {
    return this.productsSvc.list(s.id, kind === 'redeem' || kind === 'earn' ? kind : undefined);
  }

  /** Earn-more products for the counter's bonus steppers. Any staff who can add points. */
  @ShopRoute({ perm: 'canAddPoints' }) @Get('products/bonus')
  bonusProducts(@CurrentShop() s: ShopCtx) { return this.productsSvc.counterBonusList(s.id); }

  @ShopRoute({ owner: true }) @Post('products')
  upsertProduct(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.productsSvc.upsert(s.id, u.id, parse(ProductInput, body));
  }

  @ShopRoute({ owner: true }) @Get('messages/count')
  async segmentCount(@CurrentShop() s: ShopCtx, @Query('segment') seg: Segment) {
    return { count: await this.offers.countSegment(s.id, seg ?? 'all') };
  }

  @ShopRoute({ owner: true, writes: true }) @Post('messages')
  sendMessage(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(z.object({ segment: z.string(), text: z.string().min(5).max(130) }), body);
    return this.offers.sendMessage(s.id, u.id, b.segment as Segment, b.text);
  }

  // ---------------------------------------------------------------- reports (owner)
  @ShopRoute({ owner: true }) @Get('reports/dashboard')
  dashboard(@CurrentShop() s: ShopCtx, @Query('from') from?: string, @Query('to') to?: string) { return this.reports.dashboard(s.id, from, to); }

  @ShopRoute({ owner: true }) @Get('reports/daily')
  daily(@CurrentShop() s: ShopCtx, @Query('from') from?: string, @Query('to') to?: string) { return this.reports.daily(s.id, from, to); }

  @ShopRoute({ owner: true }) @Get('reports/top-customers')
  top(@CurrentShop() s: ShopCtx, @Query('by') by?: any) { return this.reports.topCustomers(s.id, by); }

  @ShopRoute({ owner: true }) @Get('reports/staff')
  staffReport(@CurrentShop() s: ShopCtx, @Query('from') from?: string, @Query('to') to?: string) { return this.reports.staffActivity(s.id, from, to); }

  @ShopRoute({ owner: true }) @Get('reports/transactions.csv')
  async csv(@CurrentShop() s: ShopCtx, @Res() res: any, @Query('from') from?: string, @Query('to') to?: string) {
    const body = await this.reports.ledgerCsv(s.id, from, to);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="mere-points-${s.id}-${from ?? 'last30'}.csv"`);
    res.send(body);
  }
}
