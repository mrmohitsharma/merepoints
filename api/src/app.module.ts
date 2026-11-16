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
import { AdminController } from './admin/admin.controller';
import { ExpiryService } from './jobs/expiry.service';
import { HealthController } from './health.controller';

@Module({
  imports: [JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { expiresIn: config.jwtTtl } })],
  controllers: [HealthController, AuthController, ShopRegisterController, ShopController, CustomerController, DiscoverController, AdminController],
  providers: [
    Db, SmsService, AuthService, ShopService, PointsService, RedeemService, OffersService, ReportsService,
    CustomerService, MilestoneService, AdminService, ExpiryService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: AllErrorsFilter },
  ],
})
export class AppModule {}
