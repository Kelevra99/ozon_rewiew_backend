import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PaymentProvider, PaymentStatus, PaymentWebhookStatus, Prisma, type Payment } from '@prisma/client';
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
    if (!Number.isInteger(amountMinor) || amountMinor < 1000) {
      throw new BadRequestException('Минимальная сумма пополнения — 10 ₽');
    }

    await this.billingService.getOrCreateWallet(userId);

    const providerOrderId = this.generateProviderOrderId();
    const successUrl = dto.successUrl?.trim() || process.env.PAYMENT_SUCCESS_URL?.trim() || null;
    const failUrl = dto.failUrl?.trim() || process.env.PAYMENT_FAIL_URL?.trim() || null;

    const payment = await this.prisma.payment.create({
      data: {
        userId,
        provider: PaymentProvider.ozon_bank,
        status: PaymentStatus.created,
        amountMinor,
        providerOrderId,
        successUrl,
        failUrl,
      },
    });

    try {
      const provider = await this.ozonAcquiringService.createPayment(payment);
      const normalizedCreateStatus = this.toPaymentStatus(
        this.ozonAcquiringService.normalizeProviderPaymentStatus(provider.providerStatus),
      );

      const updated = await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: provider.providerPaymentId,
          providerOrderId: provider.providerOrderId,
          paymentUrl: provider.redirectUrl,
          status: normalizedCreateStatus === PaymentStatus.created ? PaymentStatus.pending : normalizedCreateStatus,
          rawCreateResponseJson: this.toNullableJsonValue(provider.rawResponse),
        },
      });

      return this.serializePayment(updated);
    } catch (error) {
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: PaymentStatus.failed,
          rawCreateResponseJson: this.toNullableJsonValue({
            error: error instanceof Error ? error.message : 'create_payment_failed',
          }),
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

  async getOwn(userId: string, paymentId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, userId },
    });

    if (!payment) {
      throw new NotFoundException('Платёж не найден');
    }

    return this.serializePayment(payment);
  }

  async handleWebhook(payload: Record<string, unknown>, _rawBody?: Buffer) {
    const isValid = this.ozonAcquiringService.verifyWebhookSignature(payload);
    if (!isValid) {
      throw new UnauthorizedException('Неверная подпись webhook');
    }

    const parsed = this.ozonAcquiringService.parseWebhook(payload);

    const existingEvent = await this.prisma.paymentWebhookEvent.findUnique({
      where: {
        provider_externalEventId: {
          provider: PaymentProvider.ozon_bank,
          externalEventId: parsed.externalEventId,
        },
      },
    });

    if (existingEvent) {
      return {
        ok: true,
        duplicated: true,
        eventId: existingEvent.id,
      };
    }

    const payment = await this.findPaymentForWebhook(parsed.providerOrderId);

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

    if (parsed.normalizedStatus === 'paid') {
      await this.prisma.$transaction(async (tx) => {
        const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } });
        if (!freshPayment) {
          throw new NotFoundException('Платёж не найден');
        }

        if (freshPayment.status !== PaymentStatus.paid) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: PaymentStatus.paid,
              rawWebhookJson: this.toNullableJsonValue(parsed.rawPayload),
              paidAt: new Date(),
            },
          });

          await this.billingService.applyTopupFromPayment(tx, {
            userId: payment.userId,
            paymentId: payment.id,
            amountMinor: payment.amountMinor,
            description: `Пополнение баланса по платежу ${payment.providerOrderId}`,
            metaJson: {
              provider: 'ozon-bank',
              providerOrderId: payment.providerOrderId,
              providerPaymentId: payment.providerPaymentId,
              transactionUid: parsed.transactionUid,
            },
          });
        }

        await tx.paymentWebhookEvent.update({
          where: { id: event.id },
          data: {
            status: PaymentWebhookStatus.processed,
            processedAt: new Date(),
            paymentId: payment.id,
          },
        });
      });

      return {
        ok: true,
        eventId: event.id,
        paymentId: payment.id,
        status: 'paid',
      };
    }

    await this.prisma.$transaction(async (tx) => {
      const freshPayment = await tx.payment.findUnique({ where: { id: payment.id } });
      if (!freshPayment) {
        throw new NotFoundException('Платёж не найден');
      }

      if (freshPayment.status !== PaymentStatus.paid) {
        await tx.payment.update({
          where: { id: payment.id },
          data: {
            status: this.toPaymentStatus(parsed.normalizedStatus),
            rawWebhookJson: this.toNullableJsonValue(parsed.rawPayload),
          },
        });
      }

      await tx.paymentWebhookEvent.update({
        where: { id: event.id },
        data: {
          status: PaymentWebhookStatus.processed,
          processedAt: new Date(),
          paymentId: payment.id,
        },
      });
    });

    return {
      ok: true,
      eventId: event.id,
      paymentId: payment.id,
      status: parsed.normalizedStatus,
    };
  }

  private async findPaymentForWebhook(providerOrderId: string | null) {
    if (!providerOrderId) {
      return null;
    }

    return this.prisma.payment.findFirst({
      where: { providerOrderId },
    });
  }

  private serializePayment(payment: Payment) {
    const createPayload = this.readJsonRecord(payment.rawCreateResponseJson);
    const paymentDetails = createPayload ? this.pickObject(createPayload, 'paymentDetails') : null;
    const sbp = paymentDetails ? this.pickObject(paymentDetails, 'sbp') : null;

    const providerStatus =
      this.pickFirstString(paymentDetails, ['status']) ||
      this.pickFirstString(createPayload, ['status']) ||
      null;

    const sbpPayload = this.pickFirstString(sbp, ['payload']) || null;
    const redirectUrl = payment.paymentUrl || payment.successUrl || null;

    return {
      id: payment.id,
      provider: 'ozon-bank',
      status: payment.status,
      amountMinor: payment.amountMinor,
      amountRub: payment.amountMinor / 100,
      currency: payment.currency,
      paymentMethod: 'sbp',
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
      providerStatus,
      sbpPayload,
      paymentUrl: this.isProbablyUrl(sbpPayload) ? sbpPayload : null,
      redirectUrl,
      successUrl: payment.successUrl,
      failUrl: payment.failUrl,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      rawCreateResponseJson: payment.rawCreateResponseJson,
      rawWebhookJson: payment.rawWebhookJson,
    };
  }

  private generateProviderOrderId() {
    return `topup_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private toPaymentStatus(status: string) {
    switch (status) {
      case 'paid':
        return PaymentStatus.paid;
      case 'pending':
        return PaymentStatus.pending;
      case 'failed':
        return PaymentStatus.failed;
      case 'canceled':
        return PaymentStatus.canceled;
      default:
        return PaymentStatus.created;
    }
  }

  private isProbablyUrl(value: string | null) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  private readJsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private pickObject(obj: Record<string, unknown> | null, key: string) {
    if (!obj) return null;
    const value = obj[key];
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private pickFirstString(obj: Record<string, unknown> | null, keys: string[]) {
    if (!obj) return null;
    for (const key of keys) {
      const value = obj[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number') return String(value);
    }
    return null;
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
}
