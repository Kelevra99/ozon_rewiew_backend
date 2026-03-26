import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ServiceTiersService } from '../service-tiers/service-tiers.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import { UpsertServiceTierDto } from './dto/upsert-service-tier.dto';

@Injectable()
export class AdminService {
  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value));
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly serviceTiersService: ServiceTiersService,
  ) {}

  async listUsers() {
    const [users, topups, spends] = await Promise.all([
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          wallet: true,
          _count: {
            select: {
              products: true,
              reviewLogs: true,
            },
          },
        },
      }),
      this.prisma.walletLedgerEntry.groupBy({
        by: ['userId'],
        where: { amountMinor: { gt: 0 } },
        _sum: { amountMinor: true },
      }),
      this.prisma.walletLedgerEntry.groupBy({
        by: ['userId'],
        where: { amountMinor: { lt: 0 } },
        _sum: { amountMinor: true },
      }),
    ]);

    const topupMap = new Map(topups.map((item) => [item.userId, item._sum.amountMinor || 0]));
    const spendMap = new Map(spends.map((item) => [item.userId, Math.abs(item._sum.amountMinor || 0)]));

    return users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      balanceMinor: user.wallet?.balanceMinor || 0,
      balanceRub: (user.wallet?.balanceMinor || 0) / 100,
      productsCount: user._count.products,
      reviewsCount: user._count.reviewLogs,
      totalTopupMinor: topupMap.get(user.id) || 0,
      totalSpentMinor: spendMap.get(user.id) || 0,
    }));
  }

  async getUser(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallet: true,
        _count: {
          select: {
            products: true,
            reviewLogs: true,
            payments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return user;
  }

  async getUserProducts(userId: string) {
    return this.prisma.product.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getUserReviews(userId: string) {
    return this.prisma.reviewLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        reviewCost: true,
        usageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async listReviews() {
    return this.prisma.reviewLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        product: {
          select: { id: true, article: true, name: true },
        },
        usageLogs: { orderBy: { createdAt: 'desc' }, take: 1 },
        reviewCost: true,
      },
    });
  }

  async getReview(reviewId: string) {
    const review = await this.prisma.reviewLog.findUnique({
      where: { id: reviewId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        product: true,
        usageLogs: true,
        reviewCost: {
          include: {
            serviceTier: true,
            exchangeRate: true,
          },
        },
        promptLogs: true,
      },
    });

    if (!review) {
      throw new NotFoundException('Review не найден');
    }

    return review;
  }

  async listPayments() {
    return this.prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        webhookEvents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async getPayment(paymentId: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        webhookEvents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!payment) {
      throw new NotFoundException('Платёж не найден');
    }

    return payment;
  }

  adjustWallet(adminUserId: string, dto: AdjustWalletDto) {
    return this.billingService.adjustWallet({
      userId: dto.userId,
      amountMinor: dto.amountMinor,
      adminUserId,
      reason: dto.reason,
      metaJson: dto.metaJson,
    });
  }

  async listExchangeRates() {
    return this.exchangeRatesService.listAll();
  }

  async createExchangeRate(adminUserId: string, dto: CreateExchangeRateDto) {
    const created = await this.exchangeRatesService.createManualRate({
      rate: dto.rate,
      effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
      adminUserId,
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'exchange-rate.create',
        entityType: 'exchange_rate',
        entityId: created.id,
        afterJson: this.toJson(created),
      },
    });

    return created;
  }

  async listServiceTiers() {
    return this.serviceTiersService.listAll();
  }

  async upsertServiceTier(adminUserId: string, dto: UpsertServiceTierDto) {
    const before = await this.prisma.serviceTier.findUnique({ where: { code: dto.code } });
    const updated = await this.serviceTiersService.upsertByCode(dto.code, {
      title: dto.title,
      openAiModel: dto.openAiModel,
      inputPriceUsdPer1m: dto.inputPriceUsdPer1m,
      outputPriceUsdPer1m: dto.outputPriceUsdPer1m,
      cachedInputPriceUsdPer1m: dto.cachedInputPriceUsdPer1m,
      isActive: dto.isActive,
      adminUserId,
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'service-tier.upsert',
        entityType: 'service_tier',
        entityId: updated.id,
        beforeJson: this.toJson(before),
        afterJson: this.toJson(updated),
      },
    });

    return updated;
  }

  async listAuditLogs() {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        adminUser: {
          select: { id: true, email: true, name: true },
        },
      },
    });
  }

  async listPromptLogs() {
    return this.prisma.promptLog.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    });
  }
}
