import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { AdminOnly, AuthUser, CurrentUser } from '../common/auth';
import { parse } from '../common/util';
import { AdminService } from './admin.service';
import { RedeemService } from '../redeem/redeem.service';
import { ExpiryService } from '../jobs/expiry.service';
import { SmsService } from '../sms/sms.service';

@AdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private admin: AdminService, private redeem: RedeemService, private expiry: ExpiryService, private sms: SmsService) {}

  @Get('stats') stats() { return this.admin.platformStats(); }

  @Get('shops')
  shops(@Query('status') status?: string, @Query('search') search?: string) { return this.admin.listShops(status, search); }

  @Post('shops/:id/status')
  setStatus(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ status: z.enum(['approved', 'rejected', 'suspended']), reason: z.string().max(300).optional() }), body);
    return this.admin.setShopStatus(u.id, Number(id), b.status, b.reason);
  }

  @Post('shops/:id/sms-credits')
  smsCredits(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const { count } = parse(z.object({ count: z.number().int().positive().max(100_000) }), body);
    return this.admin.addSmsCredits(u.id, Number(id), count);
  }

  @Get('disputes') disputes() { return this.admin.disputes(); }

  @Post('redemptions/:id/resolve')
  resolve(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parse(z.object({ action: z.enum(['confirm', 'cancel']), note: z.string().min(3).max(300) }), body);
    return this.redeem.resolveByAdmin(u.id, id, b.action, b.note);
  }

  @Get('milestones') milestones() { return this.admin.listMilestones(); }

  @Post('milestones')
  upsertMilestone(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.admin.upsertMilestone(u.id, parse(z.object({
      id: z.number().int().optional(), name: z.string().min(2).max(30), threshold: z.number().int().min(0),
      color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), perks: z.array(z.string().max(80)).max(6).optional(), active: z.boolean().optional(),
    }), body));
  }

  @Put('milestones/basis')
  basis(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const { basis } = parse(z.object({ basis: z.enum(['points', 'value']) }), body);
    return this.admin.setMilestoneBasis(u.id, basis);
  }

  @Get('audit') audit(@Query('shopId') shopId?: string) { return this.admin.audit(shopId ? Number(shopId) : undefined); }

  // Jobs are normally run by a scheduler (cron / k8s CronJob); exposed here for ops.
  @Post('jobs/expire-points') expire() { return this.expiry.run(); }
  @Post('jobs/escalate-redemptions') async escalate() { return { escalated: await this.redeem.escalateStale() }; }
  @Post('jobs/send-sms') async sendSms() { return { sent: await this.sms.deliverBatch() }; }
}
