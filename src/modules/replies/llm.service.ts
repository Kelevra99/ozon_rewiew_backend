import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

type LlmResult = {
  text: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
};

@Injectable()
export class LlmService {
  private readonly relayUrl = (process.env.AI_RELAY_URL || '').trim().replace(/\/+$/, '');
  private readonly relaySecret = (process.env.AI_RELAY_SHARED_SECRET || '').trim();
  private readonly relayTimeoutMs = Number(process.env.AI_RELAY_TIMEOUT_MS || 90000);

  private readonly client: OpenAI | null;

  constructor() {
    this.client = process.env.OPENAI_API_KEY
      ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
      : null;
  }

  async generateReply(prompt: string, modelOverride?: string): Promise<LlmResult> {
    const model = modelOverride || process.env.OPENAI_MODEL || 'gpt-5.4-mini';

    if (this.relayUrl) {
      return this.generateViaRelay(prompt, model);
    }

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
      model: String((response as any).model || model),
      promptTokens: response.usage?.input_tokens || 0,
      completionTokens: response.usage?.output_tokens || 0,
      totalTokens:
        (response.usage?.input_tokens || 0) +
        (response.usage?.output_tokens || 0),
      latencyMs: Date.now() - startedAt,
    };
  }

  private async generateViaRelay(prompt: string, model: string): Promise<LlmResult> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.relayTimeoutMs);

    try {
      const response = await fetch(`${this.relayUrl}/v1/internal/llm/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': this.relaySecret,
          'x-source-service': 'ozon-review-core',
        },
        body: JSON.stringify({
          prompt,
          model,
        }),
        signal: controller.signal,
      });

      const raw = await response.text();

      if (!response.ok) {
        throw new Error(`Relay error ${response.status}: ${raw}`);
      }

      const data = JSON.parse(raw) as Partial<LlmResult>;

      return {
        text: String(data.text || '').trim(),
        model: String(data.model || model),
        promptTokens: Number(data.promptTokens || 0),
        completionTokens: Number(data.completionTokens || 0),
        totalTokens: Number(data.totalTokens || 0),
        latencyMs: Number(data.latencyMs || Date.now() - startedAt),
      };
    } catch (_error) {
      throw new ServiceUnavailableException('LLM relay временно недоступен');
    } finally {
      clearTimeout(timer);
    }
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
