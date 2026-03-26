import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type { Payment } from '@prisma/client';

export type OzonCreatePaymentResult = {
  providerPaymentId: string | null;
  providerOrderId: string;
  sbpPayload: string | null;
  providerStatus: string | null;
  redirectUrl: string | null;
  rawResponse: Record<string, unknown>;
};

export type ParsedOzonWebhook = {
  externalEventId: string;
  eventType: string;
  providerOrderId: string | null;
  providerOperationId: string | null;
  providerStatus: string | null;
  normalizedStatus: 'paid' | 'pending' | 'failed' | 'canceled' | 'created';
  paymentMethod: string | null;
  transactionUid: string | null;
  amountMinor: number | null;
  currencyCode: string | null;
  rawPayload: Record<string, unknown>;
};

@Injectable()
export class OzonAcquiringService {
  private readonly apiBaseUrl =
    process.env.OZON_ACQUIRING_API_BASE_URL?.trim() || 'https://payapi.ozon.ru';

  private readonly createPath =
    process.env.OZON_ACQUIRING_CREATE_PATH?.trim() || '/v1/createPayment';

  private readonly getPaymentDetailsPath = '/v1/getPaymentDetails';

  async createPayment(payment: Payment) {
    const accessKey = this.getAccessKey();
    const secretKey = this.getSecretKey();
    const notificationUrl = this.getNotificationUrl();
    const redirectUrl = payment.successUrl?.trim() || process.env.PAYMENT_SUCCESS_URL?.trim() || null;

    if (!redirectUrl) {
      throw new ServiceUnavailableException(
        'PAYMENT_SUCCESS_URL не настроен. Для self-integration Ozon SBP нужен redirectUrl.',
      );
    }

    const extId = payment.providerOrderId || payment.id;
    const requestSign = this.signCreatePayment(extId, accessKey, secretKey);

    const payload: Record<string, unknown> = {
      accessKey,
      amount: {
        currencyCode: '643',
        value: String(payment.amountMinor),
      },
      extId,
      notificationUrl,
      payType: 'SBP',
      redirectUrl,
      requestSign,
      ttl: Number(process.env.OZON_ACQUIRING_PAYMENT_TTL_SECONDS || 600),
      userInfo: {
        extId: payment.userId,
      },
    };

    const response = await fetch(this.buildUrl(this.createPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const data = this.parseJsonResponse(rawText);

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Ошибка Ozon Acquiring при создании SBP-платежа: ${response.status}. ${this.extractProviderError(data)}`,
      );
    }

    const paymentDetails = this.pickObject(data, 'paymentDetails');
    const sbp = paymentDetails ? this.pickObject(paymentDetails, 'sbp') : null;

    return {
      providerPaymentId: this.pickString(paymentDetails, 'paymentId'),
      providerOrderId: extId,
      sbpPayload: this.pickString(sbp, 'payload'),
      providerStatus: this.pickString(paymentDetails, 'status'),
      redirectUrl,
      rawResponse: data,
    } satisfies OzonCreatePaymentResult;
  }

  async getPaymentDetails(providerPaymentId: string) {
    const accessKey = this.getAccessKey();
    const secretKey = this.getSecretKey();
    const requestSign = this.sha256Hex(`${providerPaymentId}${accessKey}${secretKey}`);

    const payload = {
      accessKey,
      id: providerPaymentId,
      requestSign,
    };

    const response = await fetch(this.buildUrl(this.getPaymentDetailsPath), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const data = this.parseJsonResponse(rawText);

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `Ошибка Ozon Acquiring при запросе деталей платежа: ${response.status}. ${this.extractProviderError(data)}`,
      );
    }

    return data;
  }

  verifyWebhookSignature(payload: Record<string, unknown>) {
    const provided = this.pickFirstString(payload, ['requestSign']);
    if (!provided) {
      throw new UnauthorizedException('В webhook отсутствует requestSign');
    }

    const accessKey = this.getAccessKey();
    const notificationSecret = this.getNotificationSecret();
    const extTransactionId = this.pickFirstString(payload, ['extTransactionID', 'extTransactionId']);
    const amount = this.pickFirstString(payload, ['amount']);
    const currencyCode = this.pickFirstString(payload, ['currencyCode']);

    if (!extTransactionId || !amount || !currencyCode) {
      throw new UnauthorizedException('В webhook не хватает обязательных полей для проверки подписи');
    }

    const digest = this.sha256Hex(
      `${accessKey}|||${extTransactionId}|${amount}|${currencyCode}|${notificationSecret}`,
    );

    return this.safeCompare(digest, provided.trim());
  }

  parseWebhook(payload: Record<string, unknown>) {
    const externalEventId =
      this.pickFirstString(payload, ['requestSign']) ||
      [
        this.pickFirstString(payload, ['transactionUID', 'transactionUid']),
        this.pickFirstString(payload, ['extTransactionID', 'extTransactionId']),
        this.pickFirstString(payload, ['status']),
        this.pickFirstString(payload, ['amount']),
        this.pickFirstString(payload, ['currencyCode']),
      ]
        .filter(Boolean)
        .join('|');

    return {
      externalEventId,
      eventType: this.pickFirstString(payload, ['operationType']) || 'Payment',
      providerOrderId: this.pickFirstString(payload, ['extTransactionID', 'extTransactionId', 'extOrderID', 'extOrderId']),
      providerOperationId: this.pickFirstString(payload, ['transactionUID', 'transactionUid', 'orderID', 'orderId']),
      providerStatus: this.pickFirstString(payload, ['status']),
      normalizedStatus: this.normalizeWebhookStatus(this.pickFirstString(payload, ['status'])),
      paymentMethod: this.pickFirstString(payload, ['paymentMethod']),
      transactionUid: this.pickFirstString(payload, ['transactionUID', 'transactionUid']),
      amountMinor: this.pickInteger(payload, ['amount']),
      currencyCode: this.pickFirstString(payload, ['currencyCode']),
      rawPayload: payload,
    } satisfies ParsedOzonWebhook;
  }

  normalizeProviderPaymentStatus(status?: string | null) {
    const value = (status || '').trim().toUpperCase();

    if (value === 'PAYMENT_CONFIRMED') return 'paid';
    if (['PAYMENT_REJECTED'].includes(value)) return 'failed';
    if (['PAYMENT_CANCELED', 'CANCEL_SUCCESS'].includes(value)) return 'canceled';
    if (['PAYMENT_NEW', 'PAYMENT_PROCESSING', 'PAYMENT_AUTHORIZED'].includes(value)) return 'pending';

    return 'created';
  }

  private normalizeWebhookStatus(status?: string | null) {
    const value = (status || '').trim().toUpperCase();

    if (value === 'COMPLETED') return 'paid';
    if (value === 'REJECTED') return 'failed';
    if (value === 'AUTHORIZED') return 'pending';

    return 'created';
  }

  private signCreatePayment(extId: string, accessKey: string, secretKey: string) {
    return this.sha256Hex(`${extId}${accessKey}${secretKey}`);
  }

  private getAccessKey() {
    const value =
      process.env.OZON_ACQUIRING_ACCESS_KEY?.trim() ||
      process.env.OZON_ACQUIRING_TOKEN_ID?.trim() ||
      '';

    if (!value) {
      throw new ServiceUnavailableException(
        'Не настроен accessKey Ozon Acquiring. Укажите OZON_ACQUIRING_ACCESS_KEY или OZON_ACQUIRING_TOKEN_ID.',
      );
    }

    return value;
  }

  private getSecretKey() {
    const value = process.env.OZON_ACQUIRING_SECRET_KEY?.trim() || '';
    if (!value) {
      throw new ServiceUnavailableException('Не настроен OZON_ACQUIRING_SECRET_KEY');
    }
    return value;
  }

  private getNotificationSecret() {
    const value = process.env.OZON_ACQUIRING_NOTIFICATION_SECRET?.trim() || '';
    if (!value) {
      throw new ServiceUnavailableException('Не настроен OZON_ACQUIRING_NOTIFICATION_SECRET');
    }
    return value;
  }

  private getNotificationUrl() {
    const direct = process.env.PAYMENT_WEBHOOK_URL?.trim();
    if (direct) {
      return direct;
    }

    const apiBase =
      process.env.API_PUBLIC_BASE_URL?.trim() ||
      process.env.BACKEND_PUBLIC_BASE_URL?.trim() ||
      '';

    if (!apiBase) {
      throw new ServiceUnavailableException(
        'Не настроен PAYMENT_WEBHOOK_URL или API_PUBLIC_BASE_URL/BACKEND_PUBLIC_BASE_URL для публичного webhook URL.',
      );
    }

    return `${apiBase.replace(/\/$/, '')}/v1/payments/webhook/ozon-bank`;
  }

  private buildUrl(path: string) {
    return `${this.apiBaseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }

  private parseJsonResponse(rawText: string) {
    try {
      return rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      return { rawText };
    }
  }

  private extractProviderError(data: Record<string, unknown>) {
    const message = this.pickString(data, 'message');
    if (message) {
      return message;
    }

    const code = this.pickFirstString(data, ['code']);
    return code ? `code=${code}` : 'provider_error';
  }

  private pickString(obj: Record<string, unknown> | null | undefined, key: string) {
    if (!obj) return null;
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return null;
  }

  private pickFirstString(obj: Record<string, unknown> | null | undefined, keys: string[]) {
    for (const key of keys) {
      const value = this.pickString(obj, key);
      if (value) return value;
    }
    return null;
  }

  private pickObject(obj: Record<string, unknown> | null | undefined, key: string) {
    if (!obj) return null;
    const value = obj[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private pickInteger(obj: Record<string, unknown> | null | undefined, keys: string[]) {
    const value = this.pickFirstString(obj, keys);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : null;
  }

  private safeCompare(a: string, b: string) {
    try {
      const left = Buffer.from(a, 'utf8');
      const right = Buffer.from(b, 'utf8');
      return left.length === right.length && timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }
}
