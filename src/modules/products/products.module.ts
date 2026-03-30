import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { ServiceTiersModule } from '../service-tiers/service-tiers.module';
import { LlmService } from '../replies/llm.service';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { OzonImportService } from './ozon-import.service';

@Module({
  imports: [PrismaModule, BillingModule, ServiceTiersModule],
  controllers: [ProductsController],
  providers: [ProductsService, OzonImportService, LlmService],
  exports: [ProductsService],
})
export class ProductsModule {}
