import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ExchangeRate } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveRate(): Promise<ExchangeRate> {
    const rate = await this.prisma.exchangeRate.findFirst({
      where: { isActive: true, baseCurrency: 'USD', quoteCurrency: 'RUB' },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });

    if (!rate) {
      throw new NotFoundException('Активный курс USD/RUB не задан');
    }

    return rate;
  }

  async listAll() {
    return this.prisma.exchangeRate.findMany({
      where: { baseCurrency: 'USD', quoteCurrency: 'RUB' },
      orderBy: [{ isActive: 'desc' }, { effectiveDate: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async createManualRate(data: { rate: number; effectiveDate?: Date; adminUserId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.exchangeRate.updateMany({
        where: { baseCurrency: 'USD', quoteCurrency: 'RUB', isActive: true },
        data: { isActive: false },
      });

      return tx.exchangeRate.create({
        data: {
          baseCurrency: 'USD',
          quoteCurrency: 'RUB',
          rate: new Prisma.Decimal(data.rate),
          effectiveDate: data.effectiveDate ?? new Date(),
          isActive: true,
          source: 'manual',
          createdByAdminId: data.adminUserId,
        },
      });
    });
  }
}
