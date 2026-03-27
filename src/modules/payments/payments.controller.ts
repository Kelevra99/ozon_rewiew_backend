import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  create(@CurrentUser() user: JwtUserPayload, @Body() dto: CreatePaymentDto) {
    return this.paymentsService.create(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  list(@CurrentUser() user: JwtUserPayload) {
    return this.paymentsService.listOwn(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  getOne(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') paymentId: string,
    @Query('refresh') refresh?: string,
  ) {
    return this.paymentsService.getOwn(user.sub, paymentId, refresh === '1' || refresh === 'true');
  }

  @Post('webhook/ozon-bank')
  webhook(@Body() body: Record<string, unknown>) {
    return this.paymentsService.handleWebhook(body);
  }
}
