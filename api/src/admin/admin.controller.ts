import { Body, Controller, Get, Ip, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminCtx, AdminOnly, CurrentAdmin, Public } from '../common/auth';
import { parse } from '../common/util';
import { AdminService } from './admin.service';
import { AdminAuthService } from './admin-auth.service';
import { RedeemService } from '../redeem/redeem.service';
import { ExpiryService } from '../jobs/expiry.service';
import { SmsService } from '../sms/sms.service';
import { BillingService } from '../billing/billing.service';
import { FEATURES } from '../billing/entitlements';
import { SchedulerService } from '../jobs/scheduler.service';

const role = z.enum(['owner', 'ops', 'support']);
const days = (v?: string) => Math.min(Math.max(Number(v) || 30, 7), 365);

/** Username + password login for the Mere Points team. Separate from shop/customer OTP login. */
@Controller('admin/auth')
export class AdminAuthController {
  constructor(private auth: AdminAuthService) {}

  @Public() @Post('login')
  login(@Body() body: unknown, @Ip() ip: string) {
    const b = parse(z.object({ username: z.string().min(1).max(60), password: z.string().min(1).max(200) }), body);
    return this.auth.login(b.username, b.password, ip);
  }

  @AdminOnly() @Get('me')
  me(@CurrentAdmin() a: AdminCtx) { return this.auth.me(a.id); }

  @AdminOnly() @Post('password')
  password(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    const b = parse(z.object({ current: z.string(), next: z.string().max(200) }), body);
    return this.auth.changePassword(a.id, b.current, b.next);
  }
}

/**
 * Roles:  owner = everything · ops = shops, approvals, SMS credits, billing extensions, analytics
 *         support = disputes and customer lookup (can view shops, cannot change them)
 */
@Controller('admin')
export class AdminController {
  constructor(
    private admin: AdminService, private auth: AdminAuthService, private redeem: RedeemService,
    private expiry: ExpiryService, private sms: SmsService, private billing: BillingService, private scheduler: SchedulerService,
  ) {}

  // ---------------------------------------------------------------- dashboard & analytics
  @AdminOnly() @Get('stats') stats() { return this.admin.platformStats(); }

  @AdminOnly('owner', 'ops') @Get('analytics')
  async analytics(@Query('days') d?: string) {
    const n = days(d);
    const [growth, cities, categories, topShops, billing] = await Promise.all([
      this.admin.growth(n), this.admin.byCity(), this.admin.byCategory(), this.admin.topShops(n), this.admin.billingOverview(),
    ]);
    return { days: n, growth, cities, categories, topShops, billing };
  }

  @AdminOnly('owner') @Get('revenue')
  async revenue() {
    return { months: await this.admin.revenue(), billing: await this.admin.billingOverview() };
  }

  // ---------------------------------------------------------------- shops
  @AdminOnly() @Get('shops')
  shops(@Query('status') status?: string, @Query('search') search?: string, @Query('city') city?: string, @Query('billing') billing?: string) {
    return this.admin.listShops({ status, search, city, billing });
  }

  @AdminOnly() @Get('shops/:id') shop(@Param('id') id: string) { return this.admin.shopDetail(Number(id)); }

  @AdminOnly('owner', 'ops') @Post('shops/:id/status')
  setStatus(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['approved', 'rejected', 'suspended']), reason: z.string().max(300).optional() }), body);
    return this.admin.setShopStatus(a.id, Number(id), b.status, b.reason);
  }

  @AdminOnly('owner', 'ops') @Post('shops/:id/sms-credits')
  smsCredits(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ count: z.number().int().positive().max(100_000), note: z.string().max(200).optional() }), body);
    return this.admin.addSmsCredits(a.id, Number(id), b.count, b.note);
  }

  /** Record an offline payment or give free days. */
  @AdminOnly('owner', 'ops') @Post('shops/:id/extend')
  extend(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({
      days: z.number().int().min(1).max(400), planCode: z.string().optional(),
      amountRupees: z.number().min(0).max(1_000_000).optional(), note: z.string().min(3).max(200),
    }), body);
    return this.billing.adminExtend(a.id, Number(id), b);
  }

  // ---------------------------------------------------------------- redemptions & disputes
  @AdminOnly() @Get('redemptions') redemptions(@Query('status') status?: string) { return this.admin.redemptions(status); }
  @AdminOnly() @Get('disputes') disputes() { return this.admin.disputes(); }

  @AdminOnly() @Post('redemptions/:id/resolve')
  resolve(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ action: z.enum(['confirm', 'cancel']), note: z.string().min(3).max(300) }), body);
    return this.redeem.resolveByAdmin(a.id, id, b.action, b.note);
  }

  // ---------------------------------------------------------------- customers
  @AdminOnly() @Get('customers')
  customers(@Query('q') q = '') { return q.trim().length >= 2 ? this.admin.searchCustomers(q) : []; }

  @AdminOnly() @Get('customers/:id') customer(@Param('id') id: string) { return this.admin.customerDetail(Number(id)); }

  // ---------------------------------------------------------------- payments
  @AdminOnly('owner', 'ops') @Get('payments')
  payments(@Query('shopId') shopId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.billing.payments({ shopId: shopId ? Number(shopId) : undefined, from, to });
  }

  // ---------------------------------------------------------------- plans & packs
  @AdminOnly('owner', 'ops') @Get('plans')
  async plans() { return { plans: await this.admin.plans(), addonPacks: await this.admin.addonPacks(), smsPacks: await this.admin.smsPacks(), featureCatalogue: FEATURES }; }

  @AdminOnly('owner') @Post('plans')
  upsertPlan(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    const lim = z.number().int().min(0).max(1_000_000).nullable();
    return this.admin.upsertPlan(a.id, parse(z.object({
      id: z.number().int().optional(), code: z.string().regex(/^[a-z0-9_]{2,20}$/), name: z.string().min(2).max(30),
      priceRupees: z.number().min(0).max(1_000_000), yearlyPriceRupees: z.number().min(0).max(10_000_000).nullable().optional(),
      maxStaff: z.number().int().min(0).max(100), featureKeys: z.array(z.string()).max(50),
      limits: z.object({ notifications: lim, products: lim, offers: lim, ads: lim }),
      active: z.boolean().optional(), sort: z.number().int().optional(),
    }), body));
  }

  @AdminOnly('owner') @Post('addon-packs')
  upsertAddon(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.upsertAddonPack(a.id, parse(z.object({
      id: z.number().int().optional(), code: z.string().regex(/^[a-z0-9_]{2,30}$/), kind: z.enum(['notifications', 'products', 'offers', 'ads']),
      quantity: z.number().int().positive().max(1_000_000), priceRupees: z.number().positive().max(1_000_000), active: z.boolean().optional(),
    }), body));
  }

  @AdminOnly('owner', 'ops') @Put('shops/:id/overrides')
  overrides(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.admin.setShopOverrides(a.id, Number(id), parse(z.object({
      featuresAdd: z.array(z.string()).optional(), featuresRemove: z.array(z.string()).optional(),
      limits: z.object({ notifications: z.number().int().min(0).nullable().optional(), products: z.number().int().min(0).nullable().optional(),
        offers: z.number().int().min(0).nullable().optional(), ads: z.number().int().min(0).nullable().optional() }).optional(),
    }), body));
  }

  @AdminOnly('owner') @Post('sms-packs')
  upsertPack(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.upsertSmsPack(a.id, parse(z.object({
      id: z.number().int().optional(), code: z.string().regex(/^[a-z0-9_]{2,20}$/), smsCount: z.number().int().positive().max(1_000_000),
      priceRupees: z.number().positive().max(1_000_000), active: z.boolean().optional(),
    }), body));
  }

  // ---------------------------------------------------------------- milestones
  @AdminOnly() @Get('milestones') milestones() { return this.admin.listMilestones(); }

  @AdminOnly('owner') @Post('milestones')
  upsertMilestone(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.upsertMilestone(a.id, parse(z.object({
      id: z.number().int().optional(), name: z.string().min(2).max(30), threshold: z.number().int().min(0),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), perks: z.array(z.string().max(80)).max(6).optional(), active: z.boolean().optional(),
    }), body));
  }

  @AdminOnly('owner') @Put('milestones/basis')
  basis(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    const { basis } = parse(z.object({ basis: z.enum(['points', 'value']) }), body);
    return this.admin.setMilestoneBasis(a.id, basis);
  }

  // ---------------------------------------------------------------- categories
  @AdminOnly() @Get('categories') categories() { return this.admin.categories(); }

  @AdminOnly('owner', 'ops') @Post('categories')
  upsertCategory(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.upsertCategory(a.id, parse(z.object({
      code: z.string().regex(/^[a-z0-9_]{2,20}$/), name: z.string().min(2).max(40), sort: z.number().int().optional(), active: z.boolean().optional(),
    }), body));
  }

  // ---------------------------------------------------------------- work types
  @AdminOnly() @Get('professions') professions() { return this.admin.professions(); }

  @AdminOnly('owner', 'ops') @Post('professions')
  upsertProfession(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.upsertProfession(a.id, parse(z.object({
      code: z.string().regex(/^[a-z][a-z0-9_]{1,29}$/, 'Code: small letters, numbers and _ only'), name: z.string().trim().min(2).max(40),
      nameHi: z.string().trim().max(40).nullable().optional(), icon: z.string().trim().max(8).nullable().optional(), sort: z.number().int().min(0).max(999).optional(), active: z.boolean().optional(),
    }), body));
  }

  // ---------------------------------------------------------------- settings
  @AdminOnly('owner') @Get('settings') settings() { return this.admin.settings(); }

  @AdminOnly('owner') @Put('settings')
  updateSettings(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.admin.updateSettings(a.id, parse(z.record(z.string(), z.union([z.number(), z.string()])), body) as any);
  }

  // ---------------------------------------------------------------- admin team
  @AdminOnly('owner') @Get('team') team() { return this.auth.list(); }

  @AdminOnly('owner') @Post('team')
  createAdmin(@CurrentAdmin() a: AdminCtx, @Body() body: unknown) {
    return this.auth.create(a.id, parse(z.object({ username: z.string(), name: z.string().min(2).max(60), password: z.string().max(200), role }), body));
  }

  @AdminOnly('owner') @Patch('team/:id')
  updateAdmin(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.auth.update(a.id, Number(id), parse(z.object({ name: z.string().min(2).max(60).optional(), role: role.optional(), active: z.boolean().optional() }), body));
  }

  @AdminOnly('owner') @Post('team/:id/reset-password')
  resetPassword(@CurrentAdmin() a: AdminCtx, @Param('id') id: string, @Body() body: unknown) {
    return this.auth.resetPassword(a.id, Number(id), parse(z.object({ password: z.string().max(200) }), body).password);
  }

  // ---------------------------------------------------------------- audit
  @AdminOnly('owner') @Get('audit')
  audit(@Query('shopId') shopId?: string, @Query('before') before?: string) {
    return this.admin.audit({ shopId: shopId ? Number(shopId) : undefined, before: before ? Number(before) : undefined });
  }

  // ---------------------------------------------------------------- jobs (normally run by the scheduler)
  @AdminOnly('owner') @Post('jobs/expire-points') expire() { return this.expiry.run(); }
  @AdminOnly('owner') @Post('jobs/escalate-redemptions') async escalate() { return { escalated: await this.redeem.escalateStale() }; }
  @AdminOnly('owner') @Post('jobs/send-sms') async sendSms() { return { sent: await this.sms.deliverBatch() }; }
  @AdminOnly('owner') @Post('jobs/plan-reminders') async reminders() { return { sent: await this.scheduler.planReminders() }; }
}
