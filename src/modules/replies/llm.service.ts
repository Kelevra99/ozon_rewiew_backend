import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';

@Injectable()
export class LlmService {
  private readonly client: OpenAI | null;

  constructor() {
    this.client = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  async generateReply(prompt: string, modelOverride?: string) {
    const model = modelOverride || process.env.OPENAI_MODEL || 'gpt-5.4-mini';

    if (!this.client) {
      const fallback = this.buildFallbackReply(prompt);
      return {
        text: fallback,
        model: 'mock-no-openai-key',
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        latencyMs: 0,
      };
    }

    const startedAt = Date.now();

    const response = await this.client.responses.create({
      model,
      input: prompt,
    });

    return {
      text: response.output_text.trim(),
      model,
      promptTokens: response.usage?.input_tokens || 0,
      completionTokens: response.usage?.output_tokens || 0,
      totalTokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
      latencyMs: Date.now() - startedAt,
    };
  }

  private buildFallbackReply(prompt: string) {
    if (prompt.includes('1 из 5') || prompt.includes('2 из 5')) {
      return 'Спасибо, что поделились впечатлением. Нам жаль, что товар не оправдал ожиданий. Пожалуйста, свяжитесь с нами через удобный канал — постараемся разобраться в ситуации и помочь.';
    }

    if (prompt.includes('Покупатель не оставил текст')) {
      return 'Спасибо за вашу оценку! Очень приятно, что вы выбрали наш товар. Будем рады видеть вас снова.';
    }

    return 'Спасибо за ваш отзыв! Мы ценим, что вы нашли время поделиться впечатлением, и надеемся, что товар будет радовать вас и дальше.';
  }
}
