import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async history(userId: string, page = 1, limit = 50) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);

    const total = await this.prisma.reviewLog.count({
      where: { userId },
    });

    const totalPages = Math.max(Math.ceil(total / safeLimit), 1);
    const safePage = Math.min(Math.max(page, 1), totalPages);
    const skip = (safePage - 1) * safeLimit;

    const items = await this.prisma.reviewLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: safeLimit,
      include: {
        product: {
          select: {
            id: true,
            article: true,
            name: true,
          },
        },
        usageLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        reviewCost: true,
      },
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        reviewExternalId: item.reviewExternalId,
        rating: item.rating,
        reviewText: item.reviewText,
        reviewDate: item.reviewDate,
        generatedReply: item.generatedReply,
        finalReply: item.finalReply,
        status: item.status,
        matchedProduct: item.product,
        mode: item.promptMode,
        model: item.usageLogs[0]?.model || item.reviewCost?.model || null,
        tokens: item.usageLogs[0]
          ? {
              promptTokens: item.usageLogs[0].promptTokens,
              completionTokens: item.usageLogs[0].completionTokens,
              totalTokens: item.usageLogs[0].totalTokens,
            }
          : null,
        cost: item.reviewCost
          ? {
              chargedMinor: item.reviewCost.chargedMinor,
              chargedRub: Number(item.reviewCost.chargedRub),
              openAiCostUsd: Number(item.reviewCost.openAiCostUsd),
              usdRubRate: Number(item.reviewCost.usdRubRate),
            }
          : null,
        createdAt: item.createdAt,
      })),
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

  async detail(userId: string, reviewId: string) {
    const review = await this.prisma.reviewLog.findFirst({
      where: { id: reviewId, userId },
      include: {
        product: true,
        usageLogs: {
          orderBy: { createdAt: 'desc' },
        },
        reviewCost: {
          include: {
            serviceTier: true,
            exchangeRate: true,
          },
        },
        promptLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!review) {
      throw new NotFoundException('Review не найден');
    }

    return review;
  }
}
