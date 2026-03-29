import { Injectable } from '@nestjs/common';
import { Product, User } from '@prisma/client';

@Injectable()
export class PromptBuilderService {
  build(args: {
    user: Pick<User, 'name' | 'defaultTone' | 'toneNotes' | 'brandRules'>;
    product: Product | null;
    rating: number;
    reviewText?: string | null;
    productName?: string | null;
    mode: 'standard' | 'advanced' | 'expert';
  }) {
    const reviewText = (args.reviewText || '').trim();
    const toneNotes = (args.product?.toneNotes || '').trim();
    const annotation = (args.product?.annotation || '').trim();
    const productRules = (args.product?.productRules || '').trim();
    const tonePreset = (args.product?.tonePreset || '').trim();

    const productLines = args.product
      ? [
          `Название товара: ${args.product.name}`,
          `Артикул: ${args.product.article}`,
          args.product.brand ? `Бренд: ${args.product.brand}` : null,
          args.product.model ? `Модель: ${args.product.model}` : null,
          args.product.kit ? `Комплектация: ${args.product.kit}` : null,
          tonePreset ? `Пресет тона: ${tonePreset}` : null,
          args.product.extra1Name && args.product.extra1Value
            ? `${args.product.extra1Name}: ${args.product.extra1Value}`
            : null,
          args.product.extra2Name && args.product.extra2Value
            ? `${args.product.extra2Name}: ${args.product.extra2Value}`
            : null,
        ].filter(Boolean)
      : [`Название товара: ${args.productName || 'не передано'}`];

    const assembledPrompt = [
      `Товар:\n${productLines.join('\n')}`,
      productRules ? `Специальные правила по товару:\n${productRules}` : null,
      annotation ? `Аннотация:\n${annotation}` : null,
      `Оценка:\n${args.rating} из 5`,
      `Текст отзыва:\n${reviewText || 'Покупатель не оставил текст, только оценку'}`,
    ]
      .filter(Boolean)
      .join('\n\n')
      .trim();

    const systemPrompt = toneNotes || '';

    return {
      systemPrompt,
      assembledPrompt,
      fullPrompt: [systemPrompt, assembledPrompt].filter(Boolean).join('\n\n').trim(),
      productContextJson: {
        article: args.product?.article || null,
        productName: args.product?.name || args.productName || null,
        tonePreset: tonePreset || null,
        toneNotes: toneNotes || null,
        productRules: productRules || null,
        annotation: annotation || null,
        replyContextShort: null,
        extra1Name: args.product?.extra1Name || null,
        extra1Value: args.product?.extra1Value || null,
        extra2Name: args.product?.extra2Name || null,
        extra2Value: args.product?.extra2Value || null,
        reviewText: reviewText || null,
      },
    };
  }
}
