import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuthUser, CurrentShop, CurrentUser, ShopCtx, ShopRoute } from '../common/auth';
import { parse } from '../common/util';
import { AudienceFilters, NotificationInput, NotificationsService } from './notifications.service';

/** Shop owner: create, schedule and see how a notification did. */
@Controller('shop/notifications')
export class ShopNotificationsController {
  constructor(private n: NotificationsService) {}

  @ShopRoute({ owner: true, feature: 'notifications' }) @Post('audience')
  audience(@CurrentShop() s: ShopCtx, @Body() body: unknown) { return this.n.preview(s.id, parse(AudienceFilters, body)); }

  @ShopRoute({ owner: true, writes: true, feature: 'notifications' }) @Post()
  create(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown) { return this.n.create(s.id, u.id, parse(NotificationInput, body)); }

  @ShopRoute({ owner: true, feature: 'notifications' }) @Get()
  list(@CurrentShop() s: ShopCtx) { return this.n.list(s.id); }

  @ShopRoute({ owner: true, feature: 'notifications' }) @Get(':id')
  detail(@CurrentShop() s: ShopCtx, @Param('id', ParseIntPipe) id: number) { return this.n.detail(s.id, id); }

  @ShopRoute({ owner: true, writes: true, feature: 'notifications' }) @Post(':id/cancel')
  cancel(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.n.cancel(s.id, u.id, id); }
}

/** Site Expert: phone registration, inbox, and open/click tracking. */
@Controller('me')
export class CustomerNotificationsController {
  constructor(private n: NotificationsService) {}

  @Post('devices')
  register(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    const b = parse(z.object({ token: z.string().min(20).max(4096), platform: z.enum(['android', 'ios', 'web']) }), body);
    return this.n.registerDevice(u.id, b.token, b.platform);
  }

  @Post('devices/remove')
  unregister(@CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.n.unregisterDevice(u.id, parse(z.object({ token: z.string().min(20).max(4096) }), body).token);
  }

  @Get('notifications')
  inbox(@CurrentUser() u: AuthUser, @Query('before') before?: string) { return this.n.inbox(u.id, before ? Number(before) : undefined); }

  @Get('notifications/unread-count')
  async unread(@CurrentUser() u: AuthUser) { return { unread: await this.n.unread(u.id) }; }

  @Post('notifications/:id/delivered') delivered(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.n.delivered(u.id, id); }
  @Post('notifications/:id/open') open(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.n.opened(u.id, id); }
  @Post('notifications/:id/click') click(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.n.clicked(u.id, id); }
}
