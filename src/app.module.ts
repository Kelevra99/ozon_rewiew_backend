import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { ExtensionModule } from './modules/extension/extension.module';
import { ProductsModule } from './modules/products/products.module';
import { RepliesModule } from './modules/replies/replies.module';
import { UsersModule } from './modules/users/users.module';
import { BillingModule } from './modules/billing/billing.module';
import { ExchangeRatesModule } from './modules/exchange-rates/exchange-rates.module';
import { ServiceTiersModule } from './modules/service-tiers/service-tiers.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuthModule,
    ApiKeysModule,
    ExtensionModule,
    ProductsModule,
    RepliesModule,
    UsersModule,
    BillingModule,
    ExchangeRatesModule,
    ServiceTiersModule,
    PaymentsModule,
    ReviewsModule,
    AdminModule,
  ],
})
export class AppModule {}
