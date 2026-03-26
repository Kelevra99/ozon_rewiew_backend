import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RolesGuard } from '../../common/guards/roles.guard';
import { BillingModule } from '../billing/billing.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ServiceTiersModule } from '../service-tiers/service-tiers.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PrismaModule, BillingModule, ExchangeRatesModule, ServiceTiersModule],
  controllers: [AdminController],
  providers: [AdminService, RolesGuard],
})
export class AdminModule {}
