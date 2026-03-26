import { Module } from '@nestjs/common';
import { RepliesController } from './replies.controller';
import { RepliesService } from './replies.service';
import { PromptBuilderService } from './prompt-builder.service';
import { LlmService } from './llm.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { ProductsModule } from '../products/products.module';
import { BillingModule } from '../billing/billing.module';
import { ExchangeRatesModule } from '../exchange-rates/exchange-rates.module';
import { ServiceTiersModule } from '../service-tiers/service-tiers.module';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    PrismaModule,
    ApiKeysModule,
    ProductsModule,
    BillingModule,
    ExchangeRatesModule,
    ServiceTiersModule,
  ],
  controllers: [RepliesController],
  providers: [RepliesService, PromptBuilderService, LlmService],
  exports: [RepliesService],
})
export class RepliesModule {}
