import { ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiKeysService } from '../api-keys/api-keys.service';
import { ProductsService } from '../products/products.service';
import { BillingService } from '../billing/billing.service';
import { ExchangeRatesService } from '../exchange-rates/exchange-rates.service';
import { ServiceTiersService } from '../service-tiers/service-tiers.service';
import { GenerateReplyDto } from './dto/generate-reply.dto';
import { ReplyResultDto } from './dto/reply-result.dto';
import { PromptBuilderService } from './prompt-builder.service';
import { LlmService } from './llm.service';

@Injectable()
export class RepliesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly apiKeysService: ApiKeysService,
    private readonly productsService: ProductsService,
    private readonly billingService: BillingService,
    private readonly exchangeRatesService: ExchangeRatesService,
    private readonly serviceTiersService: ServiceTiersService,
    private readonly promptBuilderService: PromptBuilderService,
    private readonly llmService: LlmService,
  ) {}

  async generate(dto: GenerateReplyDto, apiKey: string) {
    const user = await this.apiKeysService.resolveUserByRawKey(apiKey);
    if (!user) {
      throw new UnauthorizedException('Недействительный API-ключ');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Пользователь деактивирован');
    }

    await this.billingService.ensurePositiveBalance(user.id);

    const serviceTier = await this.serviceTiersService.getActiveTierByCode(dto.mode);
    const exchangeRate = await this.exchangeRatesService.getActiveRate();

    const normalizedProductMeta = this.normalizeProductMeta(dto);

    const matched = await this.productsService.matchProduct(
      user.id,
      dto.productName,
      normalizedProductMeta,
    );

    const prompt = this.promptBuilderService.build({
      user,
      product: matched.product,
      rating: dto.rating,
      reviewText: dto.reviewText,
      productName: dto.productName,
      mode: dto.mode,
    });

    const llm = await this.llmService.generateReply(prompt.fullPrompt, serviceTier.openAiModel);

    const persisted = await this.prisma.$transaction(async (tx) => {
      const reviewLog = await tx.reviewLog.create({
        data: {
          userId: user.id,
          productId: matched.product?.id || null,
          reviewExternalId: dto.reviewExternalId,
          rating: dto.rating,
          authorName: dto.authorName,
          reviewText: dto.reviewText,
          reviewDate: dto.reviewDate,
          detectedProductName: dto.productName,
          detectedProductMeta: (normalizedProductMeta || {}) as object,
          promptMode: dto.mode,
          generatedReply: llm.text,
          finalReply: llm.text,
        },
      });

      await tx.usageLog.create({
        data: {
          userId: user.id,
          reviewLogId: reviewLog.id,
          model: llm.model,
          promptTokens: llm.promptTokens,
          completionTokens: llm.completionTokens,
          totalTokens: llm.totalTokens,
          estimatedCost: new Prisma.Decimal(
            this.estimateCostUsd(serviceTier, llm.promptTokens, llm.completionTokens).toFixed(8),
          ),
          latencyMs: llm.latencyMs,
        },
      });

      await tx.promptLog.create({
        data: {
          userId: user.id,
          reviewLogId: reviewLog.id,
          serviceTierCode: serviceTier.code,
          model: llm.model,
          systemPrompt: prompt.systemPrompt,
          assembledPrompt: prompt.assembledPrompt,
          generatedReply: llm.text,
          productContextJson: prompt.productContextJson,
        },
      });

      const billing = await this.billingService.chargeForGeneratedReview(tx, {
        userId: user.id,
        reviewLog,
        serviceTier,
        exchangeRate: { id: exchangeRate.id, rate: exchangeRate.rate },
        model: llm.model,
        inputTokens: llm.promptTokens,
        outputTokens: llm.completionTokens,
        totalTokens: llm.totalTokens,
      });

      return { reviewLog, billing };
    });

    return {
      reviewLogId: persisted.reviewLog.id,
      generatedReply: llm.text,
      matchedProduct: matched.product
        ? {
            matched: true,
            confidence: matched.confidence,
            productId: matched.product.id,
            productName: matched.product.name,
            article: matched.product.article,
          }
        : {
            matched: false,
            confidence: 0,
          },
      model: llm.model,
      tokenUsage: {
        promptTokens: llm.promptTokens,
        completionTokens: llm.completionTokens,
        totalTokens: llm.totalTokens,
      },
      warnings: matched.product
        ? []
        : ['Товар не найден в базе, ответ сгенерирован без полного товарного контекста'],
      canAutopost: true,
      billing: {
        chargedMinor: persisted.billing.chargedMinor,
        chargedRub: persisted.billing.chargedRub,
        balanceAfterMinor: persisted.billing.balanceAfterMinor,
      },
    };
  }

  async setResult(dto: ReplyResultDto) {
    const reviewLog = await this.prisma.reviewLog.findUnique({
      where: { id: dto.reviewLogId },
    });

    if (!reviewLog) {
      throw new NotFoundException('Review log не найден');
    }

    return this.prisma.reviewLog.update({
      where: { id: dto.reviewLogId },
      data: {
        status: dto.status,
        finalReply: dto.finalReply || reviewLog.finalReply,
        errorText: dto.errorText,
      },
    });
  }

  private normalizeProductMeta(dto: GenerateReplyDto): Record<string, unknown> | null {
    const productMeta = dto.productMeta && typeof dto.productMeta === 'object'
      ? (dto.productMeta as Record<string, unknown>)
      : {};
    const domContext = dto.domContext && typeof dto.domContext === 'object'
      ? (dto.domContext as Record<string, unknown>)
      : {};

    const article =
      this.pickString(productMeta.article) ??
      this.pickString(productMeta.sku) ??
      this.pickString(productMeta.offerId) ??
      this.pickString(domContext.article);

    const orderNumber =
      this.pickString(productMeta.orderNumber) ??
      this.pickString(domContext.orderNumber);

    const productUrl =
      this.pickString(productMeta.productUrl) ??
      this.pickString(domContext.productUrl);

    const productRating =
      this.pickString(productMeta.productRating) ??
      this.pickString(domContext.productRating);

    const merged: Record<string, unknown> = {
      ...domContext,
      ...productMeta,
    };

    if (article) merged.article = article;
    if (orderNumber) merged.orderNumber = orderNumber;
    if (productUrl) merged.productUrl = productUrl;
    if (productRating) merged.productRating = productRating;

    return Object.keys(merged).length ? merged : null;
  }

  private pickString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim();
    return normalized || undefined;
  }

  private estimateCostUsd(serviceTier: { inputPriceUsdPer1m: Prisma.Decimal; outputPriceUsdPer1m: Prisma.Decimal }, promptTokens: number, completionTokens: number): number {
    const promptCost = (promptTokens / 1_000_000) * Number(serviceTier.inputPriceUsdPer1m);
    const completionCost = (completionTokens / 1_000_000) * Number(serviceTier.outputPriceUsdPer1m);
    return Number((promptCost + completionCost).toFixed(8));
  }
}
