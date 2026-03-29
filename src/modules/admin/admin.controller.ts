import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminService } from './admin.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import { UpsertServiceTierDto } from './dto/upsert-service-tier.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.admin, UserRole.superadmin)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('dashboard/summary')
  dashboardSummary(@Query('days') days?: string) {
    return this.adminService.getDashboardSummary(Number(days || 30));
  }

  @Get('users')
  users() {
    return this.adminService.listUsers();
  }

  @Get('users/:id')
  user(@Param('id') userId: string) {
    return this.adminService.getUser(userId);
  }

  @Get('users/:id/products')
  userProducts(@Param('id') userId: string) {
    return this.adminService.getUserProducts(userId);
  }

  @Get('users/:id/reviews')
  userReviews(@Param('id') userId: string) {
    return this.adminService.getUserReviews(userId);
  }

  @Get('reviews')
  reviews() {
    return this.adminService.listReviews();
  }

  @Get('reviews/:id')
  review(@Param('id') reviewId: string) {
    return this.adminService.getReview(reviewId);
  }

  @Get('payments')
  payments() {
    return this.adminService.listPayments();
  }

  @Get('payments/:id')
  payment(@Param('id') paymentId: string) {
    return this.adminService.getPayment(paymentId);
  }

  @Post('wallets/adjust')
  adjustWallet(@CurrentUser() admin: JwtUserPayload, @Body() dto: AdjustWalletDto) {
    return this.adminService.adjustWallet(admin.sub, dto);
  }

  @Get('exchange-rates')
  exchangeRates() {
    return this.adminService.listExchangeRates();
  }

  @Post('exchange-rates')
  createExchangeRate(@CurrentUser() admin: JwtUserPayload, @Body() dto: CreateExchangeRateDto) {
    return this.adminService.createExchangeRate(admin.sub, dto);
  }

  @Get('service-tiers')
  serviceTiers() {
    return this.adminService.listServiceTiers();
  }

  @Post('service-tiers')
  upsertServiceTier(@CurrentUser() admin: JwtUserPayload, @Body() dto: UpsertServiceTierDto) {
    return this.adminService.upsertServiceTier(admin.sub, dto);
  }

  @Get('prompt-logs')
  promptLogs() {
    return this.adminService.listPromptLogs();
  }

  @Get('prompt-logs/:id')
  promptLog(@Param('id') promptLogId: string) {
    return this.adminService.getPromptLog(promptLogId);
  }

  @Get('audit-logs')
  auditLogs() {
    return this.adminService.listAuditLogs();
  }
}
