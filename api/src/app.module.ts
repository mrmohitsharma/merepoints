import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { config } from './config';
import { Db } from './db/db.service';
import { AllErrorsFilter } from './common/errors';
import { AuthGuard } from './common/auth';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { SmsService } from './sms/sms.service';
import { ShopService } from './shop/shop.service';
import { ShopController, ShopRegisterController } from './shop/shop.controller';
import { PointsService } from './points/points.service';
import { RedeemService } from './redeem/redeem.service';
import { OffersService } from './offers/offers.service';
import { ReportsService } from './reports/reports.service';
import { CustomerService } from './customer/customer.service';
import { MilestoneService } from './customer/milestone.service';
import { CustomerController, DiscoverController } from './customer/customer.controller';
import { AdminService } from './admin/admin.service';
import { AdminAuthController, AdminController } from './admin/admin.controller';
import { AdminAuthService } from './admin/admin-auth.service';
import { BillingService } from './billing/billing.service';
import { BillingWebhookController, ShopBillingController } from './billing/billing.controller';
import { ExpiryService } from './jobs/expiry.service';
import { SchedulerService } from './jobs/scheduler.service';
import { HealthController } from './health.controller';
import { ProductsService } from './products/products.service';
import { UploadsService } from './uploads/uploads.service';
import { UploadsController } from './uploads/uploads.controller';
import { AdsService } from './ads/ads.service';
import { AdminAdsController, CustomerAdsController, ShopAdsController } from './ads/ads.controller';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtTtl } })],
  controllers: [HealthController, AuthController, ShopRegisterController, ShopController, CustomerController, DiscoverController,
    AdminAuthController, AdminController, ShopBillingController, BillingWebhookController, UploadsController,
    CustomerAdsController, ShopAdsController, AdminAdsController],
  providers: [
    Db, SmsService, AuthService, ShopService, PointsService, RedeemService, OffersService, ReportsService,
    CustomerService, MilestoneService, AdminService, AdminAuthService, BillingService, ExpiryService, SchedulerService,
    ProductsService, UploadsService, AdsService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllErrorsFilter },
  ],
})
export class AppModule {}
