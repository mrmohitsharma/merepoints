import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { E } from './errors';

export interface AuthUser { id: number; isSuperAdmin: boolean }
export interface ShopCtx {
  id: number;
  role: 'owner' | 'staff';
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  canAddPoints: boolean;
  canRedeem: boolean;
  canManual: boolean;
  manualDailyLimit: number;
}

export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);

/** Marks a route as shop-scoped. Needs header X-Shop-Id and an active membership. */
export const SHOP = 'shop';
export type ShopRequirement = { owner?: boolean; perm?: 'canAddPoints' | 'canRedeem' | 'canManual'; allowPending?: boolean };
export const ShopRoute = (req: ShopRequirement = {}) => SetMetadata(SHOP, req);

export const ADMIN = 'admin';
export const AdminOnly = () => SetMetadata(ADMIN, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const CurrentShop = createParamDecorator((_: unknown, ctx: ExecutionContext): ShopCtx => ctx.switchToHttp().getRequest().shop);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private db: Db, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw E.unauth();
    let payload: { sub: number; kind?: string };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw E.unauth('Session expired. Please log in again.');
    }
    if (payload.kind && payload.kind !== 'access') throw E.unauth();
    const user = await this.db.one<{ id: number; is_super_admin: boolean }>('SELECT id, is_super_admin FROM users WHERE id = $1', [payload.sub]);
    if (!user) throw E.unauth();
    req.user = { id: user.id, isSuperAdmin: user.is_super_admin } satisfies AuthUser;

    if (this.reflector.getAllAndOverride<boolean>(ADMIN, targets) && !user.is_super_admin) {
      throw E.forbidden('ADMIN_ONLY', 'Only Vyapar Point admins can do this');
    }

    const shopReq = this.reflector.getAllAndOverride<ShopRequirement>(SHOP, targets);
    if (shopReq) {
      const shopId = Number(req.headers['x-shop-id']);
      if (!Number.isInteger(shopId) || shopId <= 0) throw E.bad('SHOP_REQUIRED', 'X-Shop-Id header is required');
      // One PK lookup per request; cheap enough at this scale, no cache to go stale when staff are removed.
      const m = await this.db.one(
        `SELECT s.id, s.status, m.role, m.can_add_points, m.can_redeem, m.can_manual, m.manual_daily_limit
           FROM shop_members m JOIN shops s ON s.id = m.shop_id
          WHERE m.shop_id = $1 AND m.user_id = $2 AND m.active`,
        [shopId, user.id],
      );
      if (!m) throw E.forbidden('NOT_SHOP_MEMBER', 'You are not part of this shop');
      const isOwner = m.role === 'owner';
      const shop: ShopCtx = {
        id: m.id,
        role: m.role,
        status: m.status,
        canAddPoints: isOwner || m.can_add_points,
        canRedeem: isOwner || m.can_redeem,
        canManual: isOwner || m.can_manual,
        manualDailyLimit: m.manual_daily_limit,
      };
      if (shop.status !== 'approved' && !shopReq.allowPending) {
        throw E.forbidden('SHOP_NOT_APPROVED', shop.status === 'pending' ? 'Your shop is waiting for approval' : `Shop is ${shop.status}`);
      }
      if (shopReq.owner && !isOwner) throw E.forbidden('OWNER_ONLY', 'Only the shop owner can do this');
      if (shopReq.perm && !shop[shopReq.perm]) throw E.forbidden('NO_PERMISSION', 'You do not have permission for this');
      req.shop = shop;
    }
    return true;
  }
}
