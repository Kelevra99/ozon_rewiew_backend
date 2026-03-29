import { Injectable } from '@nestjs/common';
import { Product, TonePreset, User } from '@prisma/client';

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
    const compactContext = (args.product?.replyContextShort || '').trim();

    const tonePreset = args.product?.tonePreset || args.user.defaultTone || TonePreset.friendly;
    const toneNotes = compactContext ? '' : (args.product?.toneNotes || args.user.toneNotes || '');
    const productRules = compactContext ? '' : (args.product?.productRules || '');

    const productContextLines = compactContext
      ? [compactContext]
      : args.product
        ? [
            `Артикул: ${args.product.article}`,
            `Название: ${args.product.name}`,
            args.product.kit ? `Комплектация: ${args.product.kit}` : null,
            args.product.annotation ? `Аннотация: ${args.product.annotation}` : null,
            args.product.extra1Name && args.product.extra1Value
              ? `${args.product.extra1Name}: ${args.product.extra1Value}`
              : null,
            args.product.extra2Name && args.product.extra2Value
              ? `${args.product.extra2Name}: ${args.product.extra2Value}`
              : null,
          ].filter(Boolean)
        : [`Название товара из отзыва: ${args.productName || 'не передано'}`];

    const systemPrompt = [
      'Ты — ассистент бренда, который пишет краткие, вежливые и естественные ответы на отзывы покупателей OZON.',
      'Отвечай на русском языке.',
      'Не используй markdown, заголовки и списки.',
      'Не спорь с покупателем, не обещай лишнего и не признавай юридическую ответственность.',
      'Возвращай только готовый текст ответа.',
    ].join('\n');

    const assembledPrompt = `
Правила бренда:
${args.user.brandRules || 'отвечай уважительно, без канцелярита, без агрессии, без споров'}

Антонация:
preset=${tonePreset}
notes=${toneNotes || (compactContext ? 'ориентируйся на компактный контекст товара ниже' : 'без дополнительных уточнений')}

Специальные правила по товару:
${compactContext ? 'используй компактный контекст товара ниже' : (productRules || 'нет специальных правил')}

Контекст товара:
${productContextLines.join('\n')}

Оценка:
${args.rating} из 5

Текст отзыва:
${reviewText || 'Покупатель не оставил текст, только оценку'}

Правила ответа:
- не спорь с покупателем;
- не обещай лишнего;
- не признавай юридическую ответственность;
- не пиши слишком длинно;
- отвечай на русском языке;
- не используй markdown;
- не пиши заголовки;
- если отзыв без текста и оценка 4-5, поблагодари и добавь нейтральное пожелание;
- если оценка 1-2, прояви эмпатию и предложи связаться для решения вопроса;
- учитывай специальные правила по товару выше.

Режим генерации:
${args.mode}
    `.trim();

    return {
      systemPrompt,
      assembledPrompt,
      fullPrompt: `${systemPrompt}\n\n${assembledPrompt}`.trim(),
      productContextJson: {
        article: args.product?.article || null,
        productName: args.product?.name || args.productName || null,
        productRules: productRules || null,
        tonePreset,
        toneNotes: toneNotes || null,
        replyContextShort: compactContext || null,
        extra1Name: args.product?.extra1Name || null,
        extra1Value: args.product?.extra1Value || null,
        extra2Name: args.product?.extra2Name || null,
        extra2Value: args.product?.extra2Value || null,
        reviewText: reviewText || null,
      },
    };
  }
}
