import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Product, ProductImportDraft, UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { ImportCommitDto } from './dto/import-commit.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CreateProductDto } from './dto/create-product.dto';
import { GenerateReplyContextDto } from './dto/generate-reply-context.dto';
import { OzonImportService } from './ozon-import.service';
import { ServiceTiersService } from '../service-tiers/service-tiers.service';
import { LlmService } from '../replies/llm.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ozonImportService: OzonImportService,
    private readonly serviceTiersService: ServiceTiersService,
    private readonly llmService: LlmService,
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
          replyContextShort: null,
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
          replyContextShort: null,
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

  async listContextModes() {
    const order = { standard: 0, advanced: 1, expert: 2 } as const;
    const tiers = await this.serviceTiersService.listAll();

    return tiers
      .filter((tier) => tier.isActive && ['standard', 'advanced', 'expert'].includes(tier.code))
      .sort((a, b) => {
        const left = order[a.code as keyof typeof order] ?? 999;
        const right = order[b.code as keyof typeof order] ?? 999;
        return left - right;
      })
      .map((tier) => ({
        code: tier.code,
        title: tier.title,
        openAiModel: tier.openAiModel,
      }));
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
        replyContextShort: true,
        extra1Name: true,
        extra1Value: true,
        extra2Name: true,
        extra2Value: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(userId: string, dto: CreateProductDto) {
    const article = this.getString(dto.article);
    const name = this.getString(dto.name);
    const brand = this.getString(dto.brand);
    const model = this.getString(dto.model);
    const kit = this.getString(dto.kit);
    const annotation = this.getString(dto.annotation);
    const toneNotes = this.getString(dto.toneNotes);
    const productRules = this.getString(dto.productRules);
    const replyContextShort = this.getString(dto.replyContextShort);
    const extra1Name = this.getString(dto.extra1Name);
    const extra1Value = this.getString(dto.extra1Value);
    const extra2Name = this.getString(dto.extra2Name);
    const extra2Value = this.getString(dto.extra2Value);

    if (!name) {
      throw new BadRequestException('Название товара обязательно');
    }

    if (!article) {
      throw new BadRequestException('Артикул товара обязателен');
    }

    const searchText = this.buildSearchText({
      article,
      name,
      brand,
      model,
      groupKey: null,
      kit,
      annotation,
      extra1Value,
      extra2Value,
    });

    const existing = await this.prisma.product.findFirst({
      where: { userId, article },
    });

    if (existing?.isActive) {
      throw new BadRequestException('Товар с таким артикулом уже существует');
    }

    if (existing && !existing.isActive) {
      return this.prisma.product.update({
        where: { id: existing.id },
        data: {
          name,
          brand,
          model,
          kit,
          annotation,
          tonePreset: dto.tonePreset ?? 'friendly',
          toneNotes,
          productRules,
          replyContextShort,
          extra1Name,
          extra1Value,
          extra2Name,
          extra2Value,
          searchText,
          rawRowJson: { source: 'manual_create' },
          isActive: true,
        },
      });
    }

    return this.prisma.product.create({
      data: {
        userId,
        article,
        name,
        brand,
        model,
        groupKey: null,
        kit,
        annotation,
        tonePreset: dto.tonePreset ?? 'friendly',
        toneNotes,
        productRules,
        replyContextShort,
        extra1Name,
        extra1Value,
        extra2Name,
        extra2Value,
        searchText,
        rawRowJson: { source: 'manual_create' },
      },
    });
  }

  async generateReplyContext(productId: string, dto: GenerateReplyContextDto, actor?: JwtUserPayload) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Товар не найден');
    }

    if (!actor) {
      throw new ForbiddenException('Требуется авторизация');
    }

    if (actor.role === UserRole.user && product.userId !== actor.sub) {
      throw new ForbiddenException('Нет доступа к этому товару');
    }

    const tier = await this.serviceTiersService.getActiveTierByCode(dto.mode);
    const prompt = this.buildCompactContextPrompt(product);
    const llm = await this.llmService.generateReply(prompt, tier.openAiModel);
    const replyContextShort = this.getString(llm.text);

    if (!replyContextShort) {
      throw new BadRequestException('Не удалось сгенерировать компактный контекст');
    }

    const updated = await this.prisma.product.update({
      where: { id: productId },
      data: { replyContextShort },
      select: {
        id: true,
        article: true,
        name: true,
        replyContextShort: true,
        updatedAt: true,
      },
    });

    return {
      productId: updated.id,
      article: updated.article,
      productName: updated.name,
      replyContextShort: updated.replyContextShort,
      mode: dto.mode,
      model: llm.model,
      tokenUsage: {
        promptTokens: llm.promptTokens,
        completionTokens: llm.completionTokens,
        totalTokens: llm.totalTokens,
      },
    };
  }

  async update(productId: string, dto: UpdateProductDto, actor?: JwtUserPayload) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Товар не найден');
    }

    if (!actor) {
      throw new ForbiddenException('Требуется авторизация');
    }

    if (actor.role === UserRole.user && product.userId !== actor.sub) {
      throw new ForbiddenException('Нет доступа к этому товару');
    }

    const nextArticle = this.hasField(dto, 'article')
      ? this.getString(dto.article)
      : product.article;

    if (!nextArticle) {
      throw new BadRequestException('Артикул товара обязателен');
    }

    const nextName = this.hasField(dto, 'name') ? this.getString(dto.name) : product.name;
    const nextBrand = this.hasField(dto, 'brand') ? this.getString(dto.brand) : product.brand;
    const nextModel = this.hasField(dto, 'model') ? this.getString(dto.model) : product.model;
    const nextKit = this.hasField(dto, 'kit') ? this.getString(dto.kit) : product.kit;
    const nextAnnotation = this.hasField(dto, 'annotation') ? this.getString(dto.annotation) : product.annotation;
    const nextToneNotes = this.hasField(dto, 'toneNotes') ? this.getString(dto.toneNotes) : product.toneNotes;
    const nextProductRules = this.hasField(dto, 'productRules') ? this.getString(dto.productRules) : product.productRules;
    const nextReplyContextShort = this.hasField(dto, 'replyContextShort')
      ? this.getString(dto.replyContextShort)
      : product.replyContextShort;
    const nextExtra1Name = this.hasField(dto, 'extra1Name') ? this.getString(dto.extra1Name) : product.extra1Name;
    const nextExtra1Value = this.hasField(dto, 'extra1Value') ? this.getString(dto.extra1Value) : product.extra1Value;
    const nextExtra2Name = this.hasField(dto, 'extra2Name') ? this.getString(dto.extra2Name) : product.extra2Name;
    const nextExtra2Value = this.hasField(dto, 'extra2Value') ? this.getString(dto.extra2Value) : product.extra2Value;

    if (!nextName) {
      throw new BadRequestException('Название товара обязательно');
    }

    if (nextArticle !== product.article) {
      const duplicate = await this.prisma.product.findFirst({
        where: {
          userId: product.userId,
          article: nextArticle,
          id: { not: product.id },
          isActive: true,
        },
      });

      if (duplicate) {
        throw new BadRequestException('Товар с таким артикулом уже существует');
      }
    }

    const searchText = this.buildSearchText({
      article: nextArticle,
      name: nextName,
      brand: nextBrand,
      model: nextModel,
      groupKey: product.groupKey,
      kit: nextKit,
      annotation: nextAnnotation,
      extra1Value: nextExtra1Value,
      extra2Value: nextExtra2Value,
    });

    return this.prisma.product.update({
      where: { id: productId },
      data: {
        article: nextArticle,
        name: nextName,
        brand: nextBrand,
        model: nextModel,
        kit: nextKit,
        annotation: nextAnnotation,
        tonePreset: this.hasField(dto, 'tonePreset') ? (dto.tonePreset ?? product.tonePreset) : product.tonePreset,
        toneNotes: nextToneNotes,
        productRules: nextProductRules,
        replyContextShort: nextReplyContextShort,
        extra1Name: nextExtra1Name,
        extra1Value: nextExtra1Value,
        extra2Name: nextExtra2Name,
        extra2Value: nextExtra2Value,
        searchText,
      },
    });
  }

  async remove(productId: string, actor?: JwtUserPayload) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException('Товар не найден');
    }

    if (!actor) {
      throw new ForbiddenException('Требуется авторизация');
    }

    if (actor.role === UserRole.user && product.userId !== actor.sub) {
      throw new ForbiddenException('Нет доступа к этому товару');
    }

    await this.prisma.product.update({
      where: { id: productId },
      data: { isActive: false },
    });

    return { ok: true, productId };
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

  private buildCompactContextPrompt(product: Product) {
    const annotation = this.cleanHtmlText(product.annotation);
    const toneNotes = this.cleanHtmlText(product.toneNotes);
    const productRules = this.cleanHtmlText(product.productRules);

    const parts = [
      `Название товара: ${product.name}`,
      `Артикул: ${product.article}`,
      product.brand ? `Бренд: ${product.brand}` : null,
      product.model ? `Модель: ${product.model}` : null,
      product.kit ? `Комплектация: ${product.kit}` : null,
      annotation ? `Аннотация: ${annotation}` : null,
      toneNotes ? `Tone notes: ${toneNotes}` : null,
      productRules ? `Product rules: ${productRules}` : null,
      product.extra1Name && product.extra1Value ? `${product.extra1Name}: ${product.extra1Value}` : null,
      product.extra2Name && product.extra2Value ? `${product.extra2Name}: ${product.extra2Value}` : null,
    ].filter(Boolean);

    return `
Ты собираешь компактный рабочий контекст для ИИ, который отвечает на отзывы покупателей на российском маркетплейсе от лица бренда.

Задача:
из полного описания товара, правил по стилю и специальных правил собрать один компактный контекст, который потом будет подставляться в prompt генерации ответа на отзыв.

Что обязательно сохранить:
- что это за товар;
- ключевые особенности, которые реально помогают отвечать на отзывы;
- важные ограничения, совместимость, правила эксплуатации или типовые спорные моменты;
- стиль ответа, только в той части, которая реально влияет на качество ответа;
- важные формулировки, которые можно использовать в ответах.

Что нужно удалить:
- повторы;
- рекламную воду;
- HTML-разметку;
- призывы к покупке;
- длинные общие рассуждения;
- всё, что не влияет на ответ на отзыв.

Формат результата:
- простой русский текст;
- без markdown;
- без списков;
- 500–1200 символов;
- это должен быть готовый компактный контекст для генерации ответов на отзывы;
- не пиши вступление, пояснения и служебные комментарии;
- не пересказывай весь исходный текст, оставь только реально полезное.

Данные товара:
${parts.join('\n')}
    `.trim();
  }

  private cleanHtmlText(value?: string | null) {
    if (!value) return null;

    const normalized = value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/li>/gi, '; ')
      .replace(/<li>/gi, '')
      .replace(/<\/?(ul|ol|p)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\r/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return normalized || null;
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

  private hasField<T extends object>(value: T, key: string) {
    return Object.prototype.hasOwnProperty.call(value, key);
  }

  private buildSearchText(input: {
    article?: string | null;
    name?: string | null;
    brand?: string | null;
    model?: string | null;
    groupKey?: string | null;
    kit?: string | null;
    annotation?: string | null;
    extra1Value?: string | null;
    extra2Value?: string | null;
  }) {
    return this.ozonImportService.buildSearchText({
      article: input.article ?? '',
      name: input.name ?? '',
      brand: input.brand ?? null,
      model: input.model ?? null,
      groupKey: input.groupKey ?? null,
      kit: input.kit ?? null,
      annotation: input.annotation ?? null,
      extra1Value: input.extra1Value ?? null,
      extra2Value: input.extra2Value ?? null,
    });
  }
}
