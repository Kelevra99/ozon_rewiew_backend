import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BillingModule } from '../billing/billing.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { OzonAcquiringService } from './ozon-acquiring.service';

@Module({
  imports: [PrismaModule, BillingModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, OzonAcquiringService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
