import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma, ServiceTier } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const DEFAULT_SERVICE_TIERS: Array<{
  code: string;
  title: string;
  model: string;
  input: string;
  output: string;
  cachedInput: string;
}> = [
  {
    code: 'standard',
    title: 'Standard',
    model: process.env.OPENAI_MODEL_STANDARD || 'gpt-5.4-nano',
    input: process.env.OPENAI_PRICE_STANDARD_INPUT_PER_1M || '0.20',
    output: process.env.OPENAI_PRICE_STANDARD_OUTPUT_PER_1M || '1.25',
    cachedInput: process.env.OPENAI_PRICE_STANDARD_CACHED_INPUT_PER_1M || '0.02',
  },
  {
    code: 'advanced',
    title: 'Advanced',
    model: process.env.OPENAI_MODEL_ADVANCED || 'gpt-5.4-mini',
    input: process.env.OPENAI_PRICE_ADVANCED_INPUT_PER_1M || '0.75',
    output: process.env.OPENAI_PRICE_ADVANCED_OUTPUT_PER_1M || '4.50',
    cachedInput: process.env.OPENAI_PRICE_ADVANCED_CACHED_INPUT_PER_1M || '0.075',
  },
  {
    code: 'expert',
    title: 'Expert',
    model: process.env.OPENAI_MODEL_EXPERT || 'gpt-5.4',
    input: process.env.OPENAI_PRICE_EXPERT_INPUT_PER_1M || '2.50',
    output: process.env.OPENAI_PRICE_EXPERT_OUTPUT_PER_1M || '15.00',
    cachedInput: process.env.OPENAI_PRICE_EXPERT_CACHED_INPUT_PER_1M || '0.25',
  },
];

@Injectable()
export class ServiceTiersService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    const count = await this.prisma.serviceTier.count();
    if (count > 0) {
      return;
    }

    for (const tier of DEFAULT_SERVICE_TIERS) {
      await this.prisma.serviceTier.create({
        data: {
          code: tier.code,
          title: tier.title,
          openAiModel: tier.model,
          inputPriceUsdPer1m: new Prisma.Decimal(tier.input),
          outputPriceUsdPer1m: new Prisma.Decimal(tier.output),
          cachedInputPriceUsdPer1m: new Prisma.Decimal(tier.cachedInput),
          isActive: true,
        },
      });
    }
  }

  async getActiveTierByCode(code: string): Promise<ServiceTier> {
    const tier = await this.prisma.serviceTier.findFirst({
      where: { code, isActive: true },
    });

    if (!tier) {
      throw new NotFoundException(`Активный service tier '${code}' не найден`);
    }

    return tier;
  }

  async listAll() {
    return this.prisma.serviceTier.findMany({
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
    });
  }

  async upsertByCode(
    code: string,
    data: {
      title: string;
      openAiModel: string;
      inputPriceUsdPer1m: number;
      outputPriceUsdPer1m: number;
      cachedInputPriceUsdPer1m?: number | null;
      isActive?: boolean;
      adminUserId?: string;
    },
  ) {
    return this.prisma.serviceTier.upsert({
      where: { code },
      update: {
        title: data.title,
        openAiModel: data.openAiModel,
        inputPriceUsdPer1m: new Prisma.Decimal(data.inputPriceUsdPer1m),
        outputPriceUsdPer1m: new Prisma.Decimal(data.outputPriceUsdPer1m),
        cachedInputPriceUsdPer1m:
          data.cachedInputPriceUsdPer1m === undefined || data.cachedInputPriceUsdPer1m === null
            ? null
            : new Prisma.Decimal(data.cachedInputPriceUsdPer1m),
        isActive: data.isActive ?? true,
        updatedByAdminId: data.adminUserId,
      },
      create: {
        code,
        title: data.title,
        openAiModel: data.openAiModel,
        inputPriceUsdPer1m: new Prisma.Decimal(data.inputPriceUsdPer1m),
        outputPriceUsdPer1m: new Prisma.Decimal(data.outputPriceUsdPer1m),
        cachedInputPriceUsdPer1m:
          data.cachedInputPriceUsdPer1m === undefined || data.cachedInputPriceUsdPer1m === null
            ? null
            : new Prisma.Decimal(data.cachedInputPriceUsdPer1m),
        isActive: data.isActive ?? true,
        createdByAdminId: data.adminUserId,
        updatedByAdminId: data.adminUserId,
      },
    });
  }
}
