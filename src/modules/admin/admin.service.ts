import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { hashPassword } from '../../common/password.util';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ServiceTiersService } from '../service-tiers/service-tiers.service';
import { AdjustWalletDto } from './dto/adjust-wallet.dto';
import { CreateExchangeRateDto } from './dto/create-exchange-rate.dto';
import { UpsertServiceTierDto } from './dto/upsert-service-tier.dto';
import { SetUserPasswordDto } from './dto/set-user-password.dto';

type AdminDashboardDailyRow = {
  date: string;
  topupRub: number | string | null;
  chargedRub: number | string | null;
  openAiCostRub: number | string | null;
  grossProfitRub: number | string | null;
  repliesCount: number | string;
  paidPaymentsCount: number | string;
  promptLogsCount: number | string;
};

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly serviceTiersService: ServiceTiersService,
  ) {}

  private toJson(value: unknown) {
    if (value === null || value === undefined) {
      return null;
    }

    return JSON.parse(JSON.stringify(value));
  }

  private toNumber(value: unknown) {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : 0;
    }

    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
  }

  async getDashboardSummary(days = 30) {
    const safeDays = Math.min(Math.max(Number(days) || 30, 7), 365);
    const timezone = 'Europe/Amsterdam';

    const [users, reviews, payments, promptLogs, rows] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.reviewLog.count(),
      this.prisma.payment.count(),
      this.prisma.promptLog.count(),
      this.prisma.$queryRaw<AdminDashboardDailyRow[]>`
        WITH bounds AS (
          SELECT
            ((NOW() AT TIME ZONE ${timezone})::date - (${safeDays} - 1) * INTERVAL '1 day')::date AS start_day,
            (NOW() AT TIME ZONE ${timezone})::date AS end_day
        ),
        days AS (
          SELECT generate_series(
            (SELECT start_day FROM bounds),
            (SELECT end_day FROM bounds),
            INTERVAL '1 day'
          )::date AS day
        ),
        topups AS (
          SELECT
            (p."paidAt" AT TIME ZONE ${timezone})::date AS day,
            COUNT(*)::int AS "paidPaymentsCount",
            COALESCE(ROUND(SUM((p."amountMinor"::numeric / 100))::numeric, 6), 0)::text AS "topupRub"
          FROM "Payment" p
          WHERE p.status = 'paid'
            AND p."paidAt" IS NOT NULL
          GROUP BY 1
        ),
        review_costs AS (
          SELECT
            (rc."createdAt" AT TIME ZONE ${timezone})::date AS day,
            COUNT(*)::int AS "repliesCount",
            COALESCE(ROUND(SUM(rc."chargedRub")::numeric, 6), 0)::text AS "chargedRub",
            COALESCE(ROUND(SUM(rc."openAiCostRub")::numeric, 6), 0)::text AS "openAiCostRub"
          FROM "ReviewCost" rc
          GROUP BY 1
        ),
        prompt_logs AS (
          SELECT
            (pl."createdAt" AT TIME ZONE ${timezone})::date AS day,
            COUNT(*)::int AS "promptLogsCount"
          FROM "PromptLog" pl
          GROUP BY 1
        )
        SELECT
          days.day::text AS "date",
          COALESCE(t."topupRub", '0') AS "topupRub",
          COALESCE(rc."chargedRub", '0') AS "chargedRub",
          COALESCE(rc."openAiCostRub", '0') AS "openAiCostRub",
          COALESCE(
            ROUND(
              (
                COALESCE((rc."chargedRub")::numeric, 0)
                - COALESCE((rc."openAiCostRub")::numeric, 0)
              )::numeric,
              6
            ),
            0
          )::text AS "grossProfitRub",
          COALESCE(rc."repliesCount", 0)::int AS "repliesCount",
          COALESCE(t."paidPaymentsCount", 0)::int AS "paidPaymentsCount",
          COALESCE(pl."promptLogsCount", 0)::int AS "promptLogsCount"
        FROM days
        LEFT JOIN topups t ON t.day = days.day
        LEFT JOIN review_costs rc ON rc.day = days.day
        LEFT JOIN prompt_logs pl ON pl.day = days.day
        ORDER BY days.day ASC
      `,
    ]);

    const items = rows.map((row) => ({
      date: row.date,
      topupRub: this.toNumber(row.topupRub),
      chargedRub: this.toNumber(row.chargedRub),
      openAiCostRub: this.toNumber(row.openAiCostRub),
      grossProfitRub: this.toNumber(row.grossProfitRub),
      repliesCount: this.toNumber(row.repliesCount),
      paidPaymentsCount: this.toNumber(row.paidPaymentsCount),
      promptLogsCount: this.toNumber(row.promptLogsCount),
    }));

    const today =
      items[items.length - 1] ??
      {
        date: new Date().toISOString().slice(0, 10),
        topupRub: 0,
        chargedRub: 0,
        openAiCostRub: 0,
        grossProfitRub: 0,
        repliesCount: 0,
        paidPaymentsCount: 0,
        promptLogsCount: 0,
      };

    return {
      days: safeDays,
      counts: {
        users,
        reviews,
        payments,
        promptLogs,
      },
      today,
      items,
    };
  }

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


  async setUserPassword(adminUserId: string, userId: string, dto: SetUserPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const password = dto.password.trim();

    if (!password) {
      throw new BadRequestException('Пароль не может быть пустым');
    }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
    const passwordHash = await hashPassword(password, saltRounds);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        updatedAt: new Date(),
      },
    });

    await this.prisma.adminAuditLog.create({
      data: {
        adminUserId,
        action: 'user.password.set',
        entityType: 'user',
        entityId: userId,
        afterJson: this.toJson({
          userId,
          email: user.email,
          passwordChanged: true,
        }),
      },
    });

    return {
      ok: true,
      userId,
      email: user.email,
    };
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

  async getPromptLog(promptLogId: string) {
    const promptLog = await this.prisma.promptLog.findUnique({
      where: { id: promptLogId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
        reviewLog: {
          include: {
            user: {
              select: { id: true, email: true, name: true },
            },
            product: {
              select: { id: true, article: true, name: true },
            },
            reviewCost: true,
          },
        },
      },
    });

    if (!promptLog) {
      throw new NotFoundException('Prompt log не найден');
    }

    return promptLog;
  }
}
