import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  Payment,
  PaymentProvider,
  PaymentStatus,
  PaymentWebhookStatus,
  Prisma,
  WalletLedgerReferenceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { OzonAcquiringService } from './ozon-acquiring.service';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly ozonAcquiringService: OzonAcquiringService,
  ) {}

  async create(userId: string, dto: CreatePaymentDto) {
    const amountMinor = Math.round(dto.amountRub * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      throw new BadRequestException('Сумма пополнения должна быть больше нуля');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const receiptEmail = dto.receiptEmail?.trim() || user.email;
    const receiptPhone = dto.receiptPhone?.trim() || null;

    if (!receiptEmail) {
      throw new BadRequestException('Для отправки электронного чека нужно указать e-mail');
    }

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: PaymentProvider.ozon_bank,
        status: PaymentStatus.created,
        amountMinor,
        providerOrderId: `topup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
      },
    });

    const successUrl = this.appendPaymentId(
      dto.successUrl || process.env.PAYMENT_SUCCESS_URL || `${this.frontendBaseUrl()}/billing/topup/success`,
      payment.id,
    );
    const failUrl = this.appendPaymentId(
      dto.failUrl || process.env.PAYMENT_FAIL_URL || `${this.frontendBaseUrl()}/billing/topup/fail`,
      payment.id,
    );
    const redirectUrl = this.appendPaymentId(
      process.env.PAYMENT_RESULT_URL || `${this.frontendBaseUrl()}/billing/topup/result`,
      payment.id,
    );
    const notificationUrl = process.env.PAYMENT_NOTIFICATION_URL || `${this.backendBaseUrl()}/payments/webhook/ozon-bank`;

    await this.prisma.payment.update({
      where: { id: payment.id },
      data: {
        successUrl,
        failUrl,
      },
    });

    try {
      const provider = await this.ozonAcquiringService.createPayment({
        payment,
        receiptEmail,
        receiptPhone,
        notificationUrl,
        redirectUrl,
        successUrl,
        failUrl,
      });

      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: provider.providerPaymentId,
          paymentUrl: provider.paymentUrl,
          status: this.toPaymentStatus(provider.status),
          rawCreateResponseJson: this.toNullableJsonValue({
            ...provider.rawResponse,
            _local: {
              receiptEmail,
              receiptPhone,
              redirectUrl,
              successUrl,
              failUrl,
              notificationUrl,
              sbpPayload: provider.sbpPayload,
              expiresAt: provider.expiresAt,
            },
          }),
        },
      });

      return this.serializePayment(updated);
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.failed,
          rawCreateResponseJson: {
            error: error instanceof Error ? error.message : 'create_payment_failed',
          },
        },
      });
      throw error;
    }
  }

  async listOwn(userId: string) {
    const items = await this.prisma.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => this.serializePayment(item));
  }

  async getOwn(userId: string, paymentId: string, refresh = false) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
    });

    if (!payment) {
      throw new NotFoundException('Платёж не найден');
    }

    const synced = refresh ? await this.syncPaymentStatus(payment) : payment;
    return this.serializePayment(synced);
  }

  async handleWebhook(payload: Record<string, unknown>) {
    const isValid = this.ozonAcquiringService.verifyWebhookSignature(payload);
    if (!isValid) {
      throw new UnauthorizedException('Неверная подпись webhook');
    }

    const parsed = this.ozonAcquiringService.parseWebhook(payload);

    const existingEvent = parsed.externalEventId
      ? await this.prisma.paymentWebhookEvent.findUnique({
          where: {
            provider_externalEventId: {
              provider: PaymentProvider.ozon_bank,
              externalEventId: parsed.externalEventId,
            },
          },
        })
      : null;

    if (existingEvent) {
      return {
        ok: true,
        duplicated: true,
        eventId: existingEvent.id,
      };
    }

    const payment = await this.findPaymentForWebhook(parsed);

    const event = await this.prisma.paymentWebhookEvent.create({
      data: {
        paymentId: payment?.id || null,
        provider: PaymentProvider.ozon_bank,
        eventType: parsed.eventType,
        externalEventId: parsed.externalEventId,
        payloadJson: this.toJsonValue(parsed.rawPayload),
        status: PaymentWebhookStatus.received,
      },
    });

    if (!payment) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: PaymentWebhookStatus.ignored,
          processedAt: new Date(),
        },
      });

      return {
        ok: true,
        ignored: true,
        reason: 'payment_not_found',
        eventId: event.id,
      };
    }

    const updatedPayment = await this.applyProviderStatus(payment.id, parsed.status, parsed.rawPayload, parsed.errorMessage);

    await this.prisma.paymentWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: PaymentWebhookStatus.processed,
        processedAt: new Date(),
        paymentId: updatedPayment.id,
      },
    });

    return {
      ok: true,
      eventId: event.id,
      paymentId: updatedPayment.id,
      status: updatedPayment.status,
    };
  }

  private async syncPaymentStatus(payment: Payment) {
    if (
      payment.status === PaymentStatus.paid ||
      payment.status === PaymentStatus.failed ||
      payment.status === PaymentStatus.canceled ||
      !payment.providerPaymentId
    ) {
      return payment;
    }

    try {
      const provider = await this.ozonAcquiringService.getPaymentDetails(payment.providerPaymentId);
      return this.applyProviderStatus(payment.id, this.toPaymentStatus(provider.status), provider.rawResponse, provider.errorMessage);
    } catch {
      return payment;
    }
  }

  private async applyProviderStatus(
    paymentId: string,
    nextStatus: PaymentStatus,
    rawPayload: unknown,
    errorMessage?: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!current) {
        throw new NotFoundException('Платёж не найден');
      }

      if (current.status === PaymentStatus.paid) {
        return current;
      }

      if (nextStatus === PaymentStatus.paid) {
        const existingLedger = await tx.walletLedgerEntry.findFirst({
          where: {
            referenceType: WalletLedgerReferenceType.payment,
            referenceId: paymentId,
          },
        });

        const updatedPayment = await tx.payment.update({
          where: { id: paymentId },
          data: {
            status: PaymentStatus.paid,
            rawWebhookJson: this.toNullableJsonValue({
              rawPayload,
              errorMessage,
            }),
            paidAt: current.paidAt || new Date(),
          },
        });

        if (!existingLedger) {
          await this.billingService.applyTopupFromPayment(tx, {
            userId: current.userId,
            paymentId: current.id,
            amountMinor: current.amountMinor,
            description: `Пополнение баланса по платежу ${current.id}`,
            metaJson: {
              providerPaymentId: current.providerPaymentId,
              providerOrderId: current.providerOrderId,
            },
          });
        }

        return updatedPayment;
      }

  

      return tx.payment.update({
        where: { id: paymentId },
        data: {
          status: nextStatus,
          rawWebhookJson: this.toNullableJsonValue({
            rawPayload,
            errorMessage,
          }),
        },
      });
    });
  }

  private async findPaymentForWebhook(parsed: {
    paymentId: string | null;
    providerPaymentId: string | null;
    providerOrderId: string | null;
  }) {
    if (parsed.paymentId) {
      const byId = await this.prisma.payment.findUnique({ where: { id: parsed.paymentId } });
      if (byId) {
        return byId;
      }
    }

    if (parsed.providerPaymentId) {
      const byProviderPaymentId = await this.prisma.payment.findFirst({
        where: { providerPaymentId: parsed.providerPaymentId },
      });
      if (byProviderPaymentId) {
        return byProviderPaymentId;
      }
    }

    if (parsed.providerOrderId) {
      const byProviderOrderId = await this.prisma.payment.findFirst({
        where: { providerOrderId: parsed.providerOrderId },
      });
      if (byProviderOrderId) {
        return byProviderOrderId;
      }
    }

    return null;
  }

  private serializePayment(payment: Payment) {
    const rawCreate = this.asRecord(payment.rawCreateResponseJson);
    const rawWebhook = this.asRecord(payment.rawWebhookJson);
    const local = rawCreate ? this.asRecord(rawCreate._local) : null;

    return {
      id: payment.id,
      provider: payment.provider,
      status: payment.status,
      amountMinor: payment.amountMinor,
      amountRub: payment.amountMinor / 100,
      currency: payment.currency,
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
      paymentUrl: payment.paymentUrl,
      sbpPayload: this.pickFirstString(local, ['sbpPayload']),
      receiptEmail: this.pickFirstString(local, ['receiptEmail']),
      receiptPhone: this.pickFirstString(local, ['receiptPhone']),
      expiresAt: this.pickFirstString(local, ['expiresAt']),
      successUrl: payment.successUrl,
      failUrl: payment.failUrl,
      errorMessage: this.pickFirstString(rawWebhook, ['errorMessage']) || this.pickFirstString(rawCreate, ['error']),
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      paidAt: payment.paidAt,
    };
  }

  private toPaymentStatus(status: 'created' | 'pending' | 'paid' | 'failed' | 'canceled') {
    const map: Record<string, PaymentStatus> = {
      created: PaymentStatus.created,
      pending: PaymentStatus.pending,
      paid: PaymentStatus.paid,
      failed: PaymentStatus.failed,
      canceled: PaymentStatus.canceled,
    };

    return map[status] || PaymentStatus.created;
  }

  private appendPaymentId(url: string, paymentId: string) {
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}paymentId=${encodeURIComponent(paymentId)}`;
  }

  private frontendBaseUrl() {
    return process.env.FRONTEND_BASE_URL || 'http://localhost:3000';
  }

  private backendBaseUrl() {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3001/v1';
    return apiBaseUrl.replace(/\/v1\/?$/, '/v1');
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
  }

  private toNullableJsonValue(
    value: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === null || value === undefined) {
      return Prisma.JsonNull;
    }

    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private asRecord(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private pickFirstString(obj: Record<string, unknown> | null, keys: string[]) {
    if (!obj) {
      return null;
    }

    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) {
        return value;
      }
    }

    return null;
  }
}
