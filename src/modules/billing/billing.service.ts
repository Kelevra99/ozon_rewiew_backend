import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReviewLog, ServiceTier, WalletCurrency, WalletLedgerEntryType, WalletLedgerReferenceType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export type ReviewChargeCalculation = {
  openAiCostUsd: Prisma.Decimal;
  usdRubRate: Prisma.Decimal;
  openAiCostRub: Prisma.Decimal;
  markupMultiplier: Prisma.Decimal;
  chargedRub: Prisma.Decimal;
  chargedMinor: number;
};

@Injectable()
export class BillingService {
  private readonly markupMultiplier = new Prisma.Decimal(process.env.BILLING_MARKUP_MULTIPLIER || '1.6');

  constructor(private readonly prisma: PrismaService) {}

  async getOrCreateWallet(userId: string) {
    const existing = await this.prisma.wallet.findUnique({ where: { userId } });
    if (existing) {
      return existing;
    }

    return this.prisma.wallet.create({
      data: {
        userId,
        currency: WalletCurrency.RUB,
      },
    });
  }

  async getBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);

    return {
      walletId: wallet.id,
      currency: wallet.currency,
      balanceMinor: wallet.balanceMinor,
      holdMinor: wallet.holdMinor,
      balanceRub: wallet.balanceMinor / 100,
      holdRub: wallet.holdMinor / 100,
      updatedAt: wallet.updatedAt,
    };
  }

  async listLedger(userId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 200);

    const total = await this.prisma.walletLedgerEntry.count({
      where: { userId },
    });

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const skip = (safePage - 1) * safeLimit;

    const items = await this.prisma.walletLedgerEntry.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
    });

    return {
      items,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        totalPages,
        hasPrev: safePage > 1,
        hasNext: safePage < totalPages,
      },
    };
  }

  async ensurePositiveBalance(userId: string) {
    const wallet = await this.getOrCreateWallet(userId);
    if (wallet.balanceMinor <= 0) {
      throw new ForbiddenException('Недостаточно средств на балансе для генерации ответа');
    }

    return wallet;
  }

  calculateReviewCharge(args: {
    serviceTier: ServiceTier;
    exchangeRate: { id: string; rate: Prisma.Decimal };
    inputTokens: number;
    outputTokens: number;
  }): ReviewChargeCalculation {
    const inputTokens = new Prisma.Decimal(args.inputTokens);
    const outputTokens = new Prisma.Decimal(args.outputTokens);
    const oneMillion = new Prisma.Decimal(1_000_000);

    const openAiCostUsd = inputTokens
      .div(oneMillion)
      .mul(args.serviceTier.inputPriceUsdPer1m)
      .plus(outputTokens.div(oneMillion).mul(args.serviceTier.outputPriceUsdPer1m));

    const openAiCostRub = openAiCostUsd.mul(args.exchangeRate.rate);
    const chargedRub = openAiCostRub.mul(this.markupMultiplier);
    const chargedMinor = Math.round(Number(chargedRub.toFixed(8)) * 100);

    return {
      openAiCostUsd,
      usdRubRate: args.exchangeRate.rate,
      openAiCostRub,
      markupMultiplier: this.markupMultiplier,
      chargedRub,
      chargedMinor,
    };
  }

  async chargeForGeneratedReview(
    tx: Prisma.TransactionClient,
    args: {
      userId: string;
      reviewLog: ReviewLog;
      serviceTier: ServiceTier;
      exchangeRate: { id: string; rate: Prisma.Decimal };
      model: string;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
    },
  ) {
    const wallet = await tx.wallet.findUnique({ where: { userId: args.userId } });
    if (!wallet) {
      throw new NotFoundException('Кошелёк пользователя не найден');
    }

    const calculation = this.calculateReviewCharge({
      serviceTier: args.serviceTier,
      exchangeRate: args.exchangeRate,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
    });

    if (wallet.balanceMinor < calculation.chargedMinor) {
      throw new ForbiddenException('Недостаточно средств на балансе для списания стоимости генерации');
    }

    await tx.reviewCost.create({
      data: {
        userId: args.userId,
        reviewLogId: args.reviewLog.id,
        serviceTierId: args.serviceTier.id,
        exchangeRateId: args.exchangeRate.id,
        model: args.model,
        inputTokens: args.inputTokens,
        outputTokens: args.outputTokens,
        totalTokens: args.totalTokens,
        openAiCostUsd: calculation.openAiCostUsd,
        usdRubRate: calculation.usdRubRate,
        openAiCostRub: calculation.openAiCostRub,
        markupMultiplier: calculation.markupMultiplier,
        chargedRub: calculation.chargedRub,
        chargedMinor: calculation.chargedMinor,
      },
    });

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balanceMinor: {
          decrement: calculation.chargedMinor,
        },
      },
    });

    await tx.walletLedgerEntry.create({
      data: {
        userId: args.userId,
        walletId: wallet.id,
        type: WalletLedgerEntryType.debit_review_generation,
        amountMinor: -calculation.chargedMinor,
        currency: wallet.currency,
        referenceType: WalletLedgerReferenceType.review_log,
        referenceId: args.reviewLog.id,
        description: `Списание за генерацию ответа на отзыв ${args.reviewLog.reviewExternalId}`,
        metaJson: {
          model: args.model,
          reviewExternalId: args.reviewLog.reviewExternalId,
          serviceTierCode: args.serviceTier.code,
        },
      },
    });

    return {
      chargedMinor: calculation.chargedMinor,
      chargedRub: Number(calculation.chargedRub.toFixed(8)),
      balanceAfterMinor: updatedWallet.balanceMinor,
      balanceAfterRub: updatedWallet.balanceMinor / 100,
    };
  }

  async applyTopupFromPayment(
    tx: Prisma.TransactionClient,
    args: { userId: string; paymentId: string; amountMinor: number; description?: string; metaJson?: object },
  ) {
    const existingEntry = await tx.walletLedgerEntry.findFirst({
      where: {
        userId: args.userId,
        referenceType: WalletLedgerReferenceType.payment,
        referenceId: args.paymentId,
      },
    });

    if (existingEntry) {
      return tx.wallet.upsert({
        where: { userId: args.userId },
        update: {},
        create: {
          userId: args.userId,
          currency: WalletCurrency.RUB,
        },
      });
    }

    const wallet = await tx.wallet.upsert({
      where: { userId: args.userId },
      update: {},
      create: {
        userId: args.userId,
        currency: WalletCurrency.RUB,
      },
    });

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: {
        balanceMinor: {
          increment: args.amountMinor,
        },
      },
    });

    await tx.walletLedgerEntry.create({
      data: {
        userId: args.userId,
        walletId: wallet.id,
        type: WalletLedgerEntryType.topup,
        amountMinor: args.amountMinor,
        currency: wallet.currency,
        referenceType: WalletLedgerReferenceType.payment,
        referenceId: args.paymentId,
        description: args.description || 'Пополнение баланса',
        metaJson: args.metaJson,
      },
    });

    return updatedWallet;
  }

  async adjustWallet(args: {
    userId: string;
    amountMinor: number;
    adminUserId: string;
    reason: string;
    metaJson?: object;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId: args.userId },
        update: {},
        create: {
          userId: args.userId,
          currency: WalletCurrency.RUB,
        },
      });

      const updatedWallet = await tx.wallet.update({
        where: { id: wallet.id },
        data: {
          balanceMinor: {
            increment: args.amountMinor,
          },
        },
      });

      const ledgerEntry = await tx.walletLedgerEntry.create({
        data: {
          userId: args.userId,
          walletId: wallet.id,
          type: WalletLedgerEntryType.manual_adjustment,
          amountMinor: args.amountMinor,
          currency: wallet.currency,
          referenceType: WalletLedgerReferenceType.admin_adjustment,
          description: args.reason,
          metaJson: args.metaJson,
        },
      });

      await tx.adminAuditLog.create({
        data: {
          adminUserId: args.adminUserId,
          action: 'wallet.adjust',
          entityType: 'wallet',
          entityId: wallet.id,
          beforeJson: { balanceMinor: wallet.balanceMinor },
          afterJson: { balanceMinor: updatedWallet.balanceMinor },
          metaJson: {
            userId: args.userId,
            amountMinor: args.amountMinor,
            reason: args.reason,
            ledgerEntryId: ledgerEntry.id,
          },
        },
      });

      return {
        walletId: wallet.id,
        balanceMinor: updatedWallet.balanceMinor,
        balanceRub: updatedWallet.balanceMinor / 100,
        ledgerEntryId: ledgerEntry.id,
      };
    });
  }
}
