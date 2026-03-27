import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import { Payment } from '@prisma/client';

type CreateOzonPaymentArgs = {
  payment: Payment;
  receiptEmail: string;
  receiptPhone?: string | null;
  notificationUrl: string;
  redirectUrl: string;
  successUrl: string;
  failUrl: string;
};

type ParsedWebhook = {
  externalEventId: string;
  eventType: string;
  paymentId: string | null;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  status: 'created' | 'pending' | 'paid' | 'failed' | 'canceled';
  errorMessage: string | null;
  rawPayload: Record<string, unknown>;
};

@Injectable()
export class OzonAcquiringService {
  private readonly apiBaseUrl = process.env.OZON_ACQUIRING_API_BASE_URL || 'https://payapi.ozon.ru';
  private readonly accessKey = process.env.OZON_ACQUIRING_ACCESS_KEY || '';
  private readonly secretKey = process.env.OZON_ACQUIRING_SECRET_KEY || '';
  private readonly notificationSecretKey = process.env.OZON_ACQUIRING_NOTIFICATION_SECRET_KEY || '';
  private readonly ttlSeconds = Number(process.env.OZON_ACQUIRING_PAYMENT_TTL_SECONDS || 900);
  private readonly fiscalizationType = process.env.OZON_ACQUIRING_FISCALIZATION_TYPE || 'FISCAL_TYPE_SINGLE';
  private readonly itemVat = process.env.OZON_ACQUIRING_ITEM_VAT || 'VAT_0';
  private readonly itemName = process.env.OZON_ACQUIRING_ITEM_NAME || 'Пополнение баланса FineRox';

  async createPayment(args: CreateOzonPaymentArgs) {
    this.ensureConfigured();

    const extId = args.payment.providerOrderId || args.payment.id;
    const amountValue = String(args.payment.amountMinor);

    const payload = {
      accessKey: this.accessKey,
      amount: {
        currencyCode: '643',
        value: amountValue,
      },
      extId,
      notificationUrl: args.notificationUrl,
      order: {
        amount: {
          currencyCode: '643',
          value: amountValue,
        },
        enableFiscalization: true,
        extData: {
          paymentId: args.payment.id,
          userId: args.payment.userId,
        },
        extId,
        failUrl: args.failUrl,
        fiscalizationType: this.fiscalizationType,
        ...(args.receiptPhone ? { fiscalizationPhone: args.receiptPhone } : {}),
        items: [
          {
            extId,
            name: this.itemName,
            price: {
              currencyCode: '643',
              value: amountValue,
            },
            quantity: 1,
            vat: this.itemVat,
          },
        ],
        mode: 'MODE_FULL',
        notificationUrl: args.notificationUrl,
        paymentAlgorithm: 'PAY_ALGO_SMS',
        receiptEmail: args.receiptEmail,
        successUrl: args.successUrl,
      },
      payType: 'SBP',
      redirectUrl: args.redirectUrl,
      requestSign: this.buildRequestSign('createPayment', { extId }),
      ttl: this.ttlSeconds,
    };

    const data = await this.postJson('/v1/createPayment', payload);
    const paymentDetails = this.pickFirstObject(data, ['paymentDetails']);
    const order = this.pickFirstObject(data, ['order']);
    const orderItem = order ? this.pickFirstObject(order, ['item']) : null;
    const sbp = paymentDetails ? this.pickFirstObject(paymentDetails, ['sbp']) : null;

    return {
      providerPaymentId:
        this.pickFirstString(paymentDetails || {}, ['paymentId']) ||
        this.pickFirstString(data, ['paymentId']) ||
        null,
      providerOrderId: extId,
      paymentUrl:
        this.pickFirstString(orderItem || {}, ['payLink']) ||
        this.pickFirstString(order || {}, ['payLink']) ||
        this.pickFirstString(data, ['redirectUrl']) ||
        args.redirectUrl,
      sbpPayload: this.pickFirstString(sbp || {}, ['payload']),
      expiresAt: this.pickFirstString(orderItem || {}, ['expiresAt']) || this.pickFirstString(order || {}, ['expiresAt']),
      status: this.normalizeCreateStatus(
        this.pickFirstString(paymentDetails || {}, ['status']) ||
          this.pickFirstString(orderItem || {}, ['status']) ||
          this.pickFirstString(order || {}, ['status']),
      ),
      rawResponse: data,
    };
  }

  async getPaymentDetails(providerPaymentId: string) {
    this.ensureConfigured();

    const payload = {
      accessKey: this.accessKey,
      id: providerPaymentId,
      requestSign: this.buildRequestSign('getPaymentDetails', { id: providerPaymentId }),
    };

    const data = await this.postJson('/v1/getPaymentDetails', payload);
    const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
    const latest = this.pickLatestOperation(items);

    return {
      status: this.normalizeOperationStatus(this.pickFirstString(latest || {}, ['status'])),
      errorMessage: this.pickFirstString(latest || {}, ['errorMessage', 'message']),
      rawResponse: data,
    };
  }

  verifyWebhookSignature(payload: Record<string, unknown>) {
    if (!this.notificationSecretKey) {
      return true;
    }

    const requestSign = this.pickFirstString(payload, ['requestSign']);
    if (!requestSign) {
      throw new UnauthorizedException('В webhook отсутствует requestSign');
    }

    const orderId = this.pickFirstString(payload, ['orderID', 'orderId']);
    const extOrderId = this.pickFirstString(payload, ['extOrderID', 'extOrderId']) || '';
    const extTransactionId = this.pickFirstString(payload, ['extTransactionID', 'extTransactionId']) || '';
    const transactionId = this.pickFirstString(payload, ['transactionID', 'transactionId']);
    const transactionUid = this.pickFirstString(payload, ['transactionUID', 'transactionUid']);
    const amount = this.pickFirstString(payload, ['amount']) || '';
    const currencyCode = this.pickFirstString(payload, ['currencyCode']) || '';

    const digest = orderId
      ? [
          this.accessKey,
          orderId,
          transactionId || transactionUid || '',
          extOrderId,
          amount,
          currencyCode,
          this.notificationSecretKey,
        ].join('|')
      : [this.accessKey, '', '', extTransactionId, amount, currencyCode, this.notificationSecretKey].join('|');

    const expected = this.sha256Hex(digest);
    return this.safeCompare(requestSign, expected);
  }

  parseWebhook(payload: Record<string, unknown>): ParsedWebhook {
    const extData = this.pickFirstObject(payload, ['extData']);
    const paymentId = extData ? this.pickFirstString(extData, ['paymentId']) : null;
    const providerOrderId =
      this.pickFirstString(payload, ['extTransactionID', 'extTransactionId']) ||
      this.pickFirstString(payload, ['extOrderID', 'extOrderId']);

    const transactionUid = this.pickFirstString(payload, ['transactionUID', 'transactionUid']);
    const transactionId = this.pickFirstString(payload, ['transactionID', 'transactionId']);
    const paymentTime = this.pickFirstString(payload, ['paymentTime']) || '';
    const status = this.pickFirstString(payload, ['status']);

    return {
      externalEventId:
        transactionUid ||
        transactionId ||
        `${providerOrderId || 'unknown'}:${status || 'unknown'}:${paymentTime || 'unknown'}`,
      eventType: this.pickFirstString(payload, ['operationType']) || 'Payment',
      paymentId,
      providerPaymentId: transactionUid || transactionId,
      providerOrderId,
      status: this.normalizeNotificationStatus(status),
      errorMessage: this.pickFirstString(payload, ['errorMessage']),
      rawPayload: payload,
    };
  }

  private async postJson(path: string, payload: Record<string, unknown>) {
    const response = await fetch(`${this.apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    let data: Record<string, unknown> = {};
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
    } catch {
      data = { rawText };
    }

    if (!response.ok) {
      const message = this.pickFirstString(data, ['message']) || `HTTP ${response.status}`;
      throw new ServiceUnavailableException(`Ошибка Ozon acquiring: ${message}`);
    }

    return data;
  }

  private buildRequestSign(
    method: 'createPayment' | 'getPaymentDetails' | 'cancelPayment' | 'refundPayment',
    args: { extId?: string; id?: string; paymentId?: string },
  ) {
    if (method === 'createPayment') {
      return this.sha256Hex(`${args.extId || ''}${this.accessKey}${this.secretKey}`);
    }

    if (method === 'getPaymentDetails' || method === 'cancelPayment') {
      return this.sha256Hex(`${args.id || ''}${this.accessKey}${this.secretKey}`);
    }

    return this.sha256Hex(`${args.extId || ''}${args.paymentId || ''}${this.accessKey}${this.secretKey}`);
  }

  private normalizeCreateStatus(status?: string | null): 'created' | 'pending' | 'paid' | 'failed' | 'canceled' {
    const value = (status || '').toUpperCase();
    if (!value || value === 'OPERATION_STATUS_UNSPECIFIED' || value === 'STATUS_UNSPECIFIED' || value === 'STATUS_NEW') {
      return 'pending';
    }
    return this.normalizeOperationStatus(status);
  }

  private normalizeOperationStatus(status?: string | null): 'created' | 'pending' | 'paid' | 'failed' | 'canceled' {
    const value = (status || '').toUpperCase();

    if (['PAYMENT_CONFIRMED', 'STATUS_PAID', 'COMPLETED'].includes(value)) {
      return 'paid';
    }

    if (['PAYMENT_REJECTED', 'REJECTED'].includes(value)) {
      return 'failed';
    }

    if (['PAYMENT_CANCELED', 'CANCEL_SUCCESS', 'CANCELED', 'STATUS_CANCELED', 'STATUS_EXPIRED'].includes(value)) {
      return 'canceled';
    }

    if (['PAYMENT_PROCESSING', 'PAYMENT_NEW', 'PAYMENT_AUTHORIZED', 'AUTHORIZED', 'STATUS_PAYMENT_PENDING', 'STATUS_AUTHORIZED'].includes(value)) {
      return 'pending';
    }

    return 'created';
  }

  private normalizeNotificationStatus(status?: string | null): 'created' | 'pending' | 'paid' | 'failed' | 'canceled' {
    const value = (status || '').toUpperCase();
    if (value === 'COMPLETED') {
      return 'paid';
    }
    if (value === 'REJECTED') {
      return 'failed';
    }
    if (value === 'AUTHORIZED') {
      return 'pending';
    }
    return 'created';
  }

  private pickLatestOperation(items: Record<string, unknown>[]) {
    if (!items.length) {
      return null;
    }

    return [...items].sort((left, right) => {
      const leftTime = Date.parse(this.pickFirstString(left, ['operationTime']) || '');
      const rightTime = Date.parse(this.pickFirstString(right, ['operationTime']) || '');

      if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
      if (Number.isNaN(leftTime)) return 1;
      if (Number.isNaN(rightTime)) return -1;
      return rightTime - leftTime;
    })[0];
  }

  private pickFirstString(obj: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
      if (typeof value === 'number') {
        return String(value);
      }
    }
    return null;
  }

  private pickFirstObject(obj: Record<string, unknown>, keys: string[]) {
    for (const key of keys) {
      const value = obj[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>;
      }
    }
    return null;
  }

  private ensureConfigured() {
    if (!this.accessKey || !this.secretKey) {
      throw new ServiceUnavailableException('Не настроены Ozon acquiring accessKey / secretKey');
    }
  }

  private sha256Hex(value: string) {
    return createHash('sha256').update(value).digest('hex');
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
