import { CanActivate, createParamDecorator, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Db } from '../db/db.service';
import { AppError, E } from './errors';
import { billingStateSql, BillingState } from '../billing/state';

export interface AuthUser { id: number; isSuperAdmin: boolean }
export type AdminRole = 'owner' | 'ops' | 'support';
export interface AdminCtx { id: number; role: AdminRole; username: string }
export interface ShopCtx {
  id: number;
  role: 'owner' | 'staff';
  status: 'pending' | 'approved' | 'rejected' | 'suspended';
  canAddPoints: boolean;
  canRedeem: boolean;
  canManual: boolean;
  manualDailyLimit: number;
  billing: BillingState;
}

export const PUBLIC = 'public';
export const Public = () => SetMetadata(PUBLIC, true);

/** Marks a route as shop-scoped. Needs header X-Shop-Id and an active membership. */
export const SHOP = 'shop';
/** writes: blocked when the shop's plan has lapsed past grace (read-only). Redeeming is never a write here. */
export type ShopRequirement = { owner?: boolean; perm?: 'canAddPoints' | 'canRedeem' | 'canManual'; allowPending?: boolean; writes?: boolean };
export const ShopRoute = (req: ShopRequirement = {}) => SetMetadata(SHOP, req);

/** Super-admin routes. Needs an admin token (username + password login) with one of these roles. */
export const ADMIN = 'admin';
export const AdminOnly = (...roles: AdminRole[]) => SetMetadata(ADMIN, roles.length ? roles : ['owner', 'ops', 'support']);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminCtx => ctx.switchToHttp().getRequest().admin);
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
    let payload: { sub: number; kind?: string; pwv?: number };
    try {
      payload = await this.jwt.verifyAsync(token);
    } catch {
      throw E.unauth('Session expired. Please log in again.');
    }

    // ---- admin portal tokens: only valid on admin routes
    const adminRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN, targets);
    if (payload.kind === 'admin') {
      if (!adminRoles) throw E.forbidden('ADMIN_TOKEN', 'Use a shop or customer login for this');
      const a = await this.db.one<{ id: number; role: AdminRole; username: string; active: boolean; pwv: number }>(
        `SELECT id, role, username, active, token_version AS pwv FROM admin_users WHERE id = $1`, [payload.sub],
      );
      // Token dies when the admin is deactivated or changes/resets their password.
      if (!a || !a.active || Number(a.pwv) !== payload.pwv) throw E.unauth('Session expired. Please log in again.');
      if (!adminRoles.includes(a.role)) throw E.forbidden('ROLE_NOT_ALLOWED', `Your role (${a.role}) cannot do this`);
      req.admin = { id: a.id, role: a.role, username: a.username } satisfies AdminCtx;
      return true;
    }
    if (adminRoles) throw E.forbidden('ADMIN_ONLY', 'Only Mere Points admins can do this');
    if (payload.kind && payload.kind !== 'access') throw E.unauth();
    const user = await this.db.one<{ id: number; is_super_admin: boolean }>('SELECT id, is_super_admin FROM users WHERE id = $1 AND deleted_at IS NULL', [payload.sub]);
    if (!user) throw E.unauth();
    req.user = { id: user.id, isSuperAdmin: user.is_super_admin } satisfies AuthUser;

    const shopReq = this.reflector.getAllAndOverride<ShopRequirement>(SHOP, targets);
    if (shopReq) {
      const shopId = Number(req.headers['x-shop-id']);
      if (!Number.isInteger(shopId) || shopId <= 0) throw E.bad('SHOP_REQUIRED', 'X-Shop-Id header is required');
      // One PK lookup per request; cheap enough at this scale, no cache to go stale when staff are removed.
      const m = await this.db.one(
        `SELECT s.id, s.status, m.role, m.can_add_points, m.can_redeem, m.can_manual, m.manual_daily_limit,
                ${billingStateSql('ss')} AS billing
           FROM shop_members m JOIN shops s ON s.id = m.shop_id
           LEFT JOIN shop_subscriptions ss ON ss.shop_id = s.id
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
        billing: m.billing,
      };
      if (shop.status !== 'approved' && !shopReq.allowPending) {
        throw E.forbidden('SHOP_NOT_APPROVED', shop.status === 'pending' ? 'Your shop is waiting for approval' : `Shop is ${shop.status}`);
      }
      if (shopReq.owner && !isOwner) throw E.forbidden('OWNER_ONLY', 'Only the shop owner can do this');
      if (shopReq.perm && !shop[shopReq.perm]) throw E.forbidden('NO_PERMISSION', 'You do not have permission for this');
      if (shopReq.writes && shop.billing === 'read_only') {
        throw new AppError(402, 'PLAN_EXPIRED', 'Your Mere Points plan has expired. Renew in Billing to add points and send SMS again. Customers can still redeem.');
      }
      req.shop = shop;
    }
    return true;
  }
}
