import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { LedgerQueryDto } from './dto/ledger-query.dto';
import { BillingService } from './billing.service';

@Controller('billing')
@UseGuards(JwtAuthGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('balance')
  balance(@CurrentUser() user: JwtUserPayload) {
    return this.billingService.getBalance(user.sub);
  }

  @Get('ledger')
  ledger(@CurrentUser() user: JwtUserPayload, @Query() query: LedgerQueryDto) {
    const page = Math.max(Number(query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(query.limit ?? query.take) || 50, 1), 200);

    return this.billingService.listLedger(user.sub, page, limit);
  }
}
