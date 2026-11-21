import { Body, Controller, Get, Headers, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AuthUser, CurrentShop, CurrentUser, ShopCtx, ShopRoute } from '../common/auth';
import { parse } from '../common/util';
import { DueInput, DuesService, PaymentInput } from './dues.service';

/** Shop side: the dues book (what customers owe this shop). */
@Controller('shop/dues')
export class ShopDuesController {
  constructor(private dues: DuesService) {}

  @ShopRoute({ perm: 'canAddPoints' }) @Get('customers')
  outstanding(@CurrentShop() s: ShopCtx) { return this.dues.outstanding(s.id); }

  @ShopRoute({ perm: 'canAddPoints' }) @Get('customer/:customerId')
  book(@CurrentShop() s: ShopCtx, @Param('customerId', ParseIntPipe) customerId: number) { return this.dues.customerBook(s.id, customerId); }

  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post()
  add(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.dues.addDue(s, u.id, parse(DueInput, body), key);
  }

  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post('pay')
  pay(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Body() body: unknown, @Headers('idempotency-key') key?: string) {
    return this.dues.addPayment(s, u.id, parse(PaymentInput, body), key);
  }

  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post(':entryId/undo')
  undo(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('entryId', ParseIntPipe) id: number) { return this.dues.undo(s, u.id, id); }

  @ShopRoute({ perm: 'canAddPoints', writes: true }) @Post('customer/:customerId/remind')
  remind(@CurrentShop() s: ShopCtx, @CurrentUser() u: AuthUser, @Param('customerId', ParseIntPipe) customerId: number) { return this.dues.remind(s, u.id, customerId); }
}

/** Customer side: read-only view of what they owe. */
@Controller('me/dues')
export class CustomerDuesController {
  constructor(private dues: DuesService) {}

  @Get() mine(@CurrentUser() u: AuthUser) { return this.dues.myDues(u.id); }
  @Get(':shopId') at(@CurrentUser() u: AuthUser, @Param('shopId', ParseIntPipe) shopId: number) { return this.dues.myDuesAt(u.id, shopId); }
}
