import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ProductImportDraft, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { ImportCommitDto } from './dto/import-commit.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { OzonImportService } from './ozon-import.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ozonImportService: OzonImportService,
  ) {}

  async previewImport(userId: string, filename: string, buffer: Buffer) {
    const parsed = this.ozonImportService.parseWorkbook(buffer);
    const availableExtraColumns = this.ozonImportService.getAvailableExtraColumns(parsed.headers);
    const draftToken = randomUUID();

    await this.prisma.productImportDraft.create({
      data: {
        userId,
        draftToken,
        originalFilename: filename,
        headersJson: parsed.headers,
        rowsJson: parsed.rows as object[],
      },
    });

    return {
      draftToken,
      sourceType: 'ozon_xlsx',
      totalRows: parsed.rows.length,
      availableExtraColumns,
      sample: parsed.rows.slice(0, 5).map((row) => {
        const base = this.ozonImportService.normalizeBaseFields(row);
        return {
          article: base.article,
          name: base.name,
          brand: base.brand,
          kit: base.kit,
          annotation: base.annotation,
        };
      }),
    };
  }

  async commitImport(userId: string, dto: ImportCommitDto) {
    const draft = await this.resolveDraft(userId, dto.draftToken);
    const headers = this.toStringArray(draft.headersJson);
    const rows = this.toRowsArray(draft.rowsJson);

    if (!headers.length || !rows.length) {
      throw new BadRequestException('Draft импорта пустой');
    }

    const importRecord = await this.prisma.productImport.create({
      data: {
        userId,
        originalFilename: draft.originalFilename,
        selectedExtra1: dto.selectedExtra1,
        selectedExtra2: dto.selectedExtra2,
      },
    });

    let importedRows = 0;

    for (const row of rows) {
      const base = this.ozonImportService.normalizeBaseFields(row);

      const extra1Name = dto.selectedExtra1 || null;
      const extra2Name = dto.selectedExtra2 || null;
      const extra1Value = extra1Name ? this.getString(row[extra1Name]) : null;
      const extra2Value = extra2Name ? this.getString(row[extra2Name]) : null;

      const searchText = this.ozonImportService.buildSearchText({
        article: base.article,
        name: base.name,
        brand: base.brand,
        model: base.model,
        groupKey: base.groupKey,
        kit: base.kit,
        annotation: base.annotation,
        extra1Value,
        extra2Value,
      });

      await this.prisma.product.upsert({
        where: {
          userId_article: {
            userId,
            article: base.article,
          },
        },
        update: {
          importId: importRecord.id,
          name: base.name,
          brand: base.brand,
          model: base.model,
          groupKey: base.groupKey,
          kit: base.kit,
          annotation: base.annotation,
          tonePreset: dto.defaultTonePreset,
          toneNotes: dto.defaultToneNotes,
          productRules: dto.defaultProductRules,
          extra1Name,
          extra1Value,
          extra2Name,
          extra2Value,
          searchText,
          rawRowJson: row as object,
          isActive: true,
        },
        create: {
          userId,
          importId: importRecord.id,
          article: base.article,
          name: base.name,
          brand: base.brand,
          model: base.model,
          groupKey: base.groupKey,
          kit: base.kit,
          annotation: base.annotation,
          tonePreset: dto.defaultTonePreset,
          toneNotes: dto.defaultToneNotes,
          productRules: dto.defaultProductRules,
          extra1Name,
          extra1Value,
          extra2Name,
          extra2Value,
          searchText,
          rawRowJson: row as object,
        },
      });

      importedRows += 1;
    }

    await this.prisma.$transaction([
      this.prisma.productImport.update({
        where: { id: importRecord.id },
        data: {
          status: 'completed',
          importedRows,
        },
      }),
      this.prisma.productImportDraft.update({
        where: { id: draft.id },
        data: { isCommitted: true },
      }),
    ]);

    return {
      draftToken: draft.draftToken,
      importId: importRecord.id,
      importedRows,
    };
  }

  async list(userId: string) {
    return this.prisma.product.findMany({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        article: true,
        name: true,
        brand: true,
        model: true,
        kit: true,
        annotation: true,
        tonePreset: true,
        toneNotes: true,
        productRules: true,
        extra1Name: true,
        extra1Value: true,
        extra2Name: true,
        extra2Value: true,
        updatedAt: true,
      },
    });
  }

  async update(productId: string, dto: UpdateProductDto, actor?: JwtUserPayload) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Товар не найден');
    }

    if (actor && actor.role === UserRole.user && product.userId !== actor.sub) {
      throw new ForbiddenException('Нет доступа к этому товару');
    }

    return this.prisma.product.update({
      where: { id: productId },
      data: dto,
    });
  }

  async matchProduct(userId: string, productName?: string | null, productMeta?: Record<string, unknown> | null) {
    const articleCandidates = [productMeta?.article, productMeta?.sku, productMeta?.offerId]
      .filter(Boolean)
      .map(String);

    for (const article of articleCandidates) {
      const exact = await this.prisma.product.findFirst({
        where: { userId, article, isActive: true },
      });
      if (exact) {
        return { matched: true, confidence: 1, product: exact };
      }
    }

    if (productName) {
      const byName = await this.prisma.product.findFirst({
        where: {
          userId,
          isActive: true,
          OR: [
            { name: { equals: productName, mode: 'insensitive' } },
            { groupKey: { equals: productName, mode: 'insensitive' } },
            { searchText: { contains: productName, mode: 'insensitive' } },
          ],
        },
      });

      if (byName) {
        return { matched: true, confidence: 0.75, product: byName };
      }
    }

    return { matched: false, confidence: 0, product: null };
  }

  private async resolveDraft(userId: string, draftToken?: string): Promise<ProductImportDraft> {
    if (draftToken) {
      const explicitDraft = await this.prisma.productImportDraft.findFirst({
        where: {
          draftToken,
          userId,
          isCommitted: false,
        },
      });

      if (!explicitDraft) {
        throw new BadRequestException('Draft импорта не найден');
      }

      return explicitDraft;
    }

    const latestDraft = await this.prisma.productImportDraft.findFirst({
      where: { userId, isCommitted: false },
      orderBy: { createdAt: 'desc' },
    });

    if (!latestDraft) {
      throw new BadRequestException('Сначала вызовите preview импорта');
    }

    return latestDraft;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.map((item) => String(item));
  }

  private toRowsArray(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  private getString(value: unknown): string | null {
    if (value === null || value === undefined) {
      return null;
    }
    const normalized = String(value).trim();
    return normalized.length ? normalized : null;
  }
}
