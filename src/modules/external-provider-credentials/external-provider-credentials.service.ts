import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExternalProvider } from '@prisma/client';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

const ALLOWED_PROVIDERS = [
  ExternalProvider.ozon,
  ExternalProvider.wildberries,
  ExternalProvider.yandex_market,
] as const;

@Injectable()
export class ExternalProviderCredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  private normalizeProvider(providerRaw: string): ExternalProvider {
    const normalized = providerRaw.trim().toLowerCase();

    if (normalized === ExternalProvider.ozon) {
      return ExternalProvider.ozon;
    }

    if (normalized === ExternalProvider.wildberries) {
      return ExternalProvider.wildberries;
    }

    if (normalized === ExternalProvider.yandex_market) {
      return ExternalProvider.yandex_market;
    }

    throw new BadRequestException('Неизвестный внешний API-провайдер');
  }

  private getMasterKey(): Buffer {
    const raw = this.configService
      .get<string>('EXTERNAL_CREDENTIALS_MASTER_KEY')
      ?.trim();

    if (!raw) {
      throw new Error(
        'EXTERNAL_CREDENTIALS_MASTER_KEY is not configured',
      );
    }

    let key: Buffer;

    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      key = Buffer.from(raw, 'hex');
    } else {
      key = Buffer.from(raw, 'base64');
    }

    if (key.length !== 32) {
      throw new Error(
        'EXTERNAL_CREDENTIALS_MASTER_KEY must be 32 bytes (hex 64 chars or base64)',
      );
    }

    return key;
  }

  private encryptSecret(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getMasterKey(), iv);

    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return {
      encryptedSecret: encrypted.toString('base64'),
      secretIv: iv.toString('base64'),
      secretAuthTag: authTag.toString('base64'),
    };
  }

  private decryptSecret(payload: {
    encryptedSecret: string;
    secretIv: string;
    secretAuthTag: string;
  }) {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.getMasterKey(),
      Buffer.from(payload.secretIv, 'base64'),
    );

    decipher.setAuthTag(Buffer.from(payload.secretAuthTag, 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(payload.encryptedSecret, 'base64')),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  }

  private maskSecret(secret: string) {
    const value = secret.trim();
    const tail = value.slice(-4);

    if (!tail) {
      return '••••••';
    }

    return `••••••${tail}`;
  }

  private serialize(item: {
    id: string;
    provider: ExternalProvider;
    maskedValue: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastUsedAt: Date | null;
    lastValidatedAt: Date | null;
  }) {
    return {
      id: item.id,
      provider: item.provider,
      isConfigured: true,
      maskedValue: item.maskedValue,
      isActive: item.isActive,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      lastUsedAt: item.lastUsedAt,
      lastValidatedAt: item.lastValidatedAt,
    };
  }

  async list(userId: string) {
    const items = await this.prisma.externalProviderCredential.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        maskedValue: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        lastValidatedAt: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const map = new Map(items.map((item) => [item.provider, item]));

    return ALLOWED_PROVIDERS.map((provider) => {
      const item = map.get(provider);

      if (!item) {
        return {
          provider,
          isConfigured: false,
          maskedValue: null,
          isActive: false,
          createdAt: null,
          updatedAt: null,
          lastUsedAt: null,
          lastValidatedAt: null,
        };
      }

      return this.serialize(item);
    });
  }

  async upsert(userId: string, providerRaw: string, secret: string) {
    const provider = this.normalizeProvider(providerRaw);
    const value = secret.trim();

    if (!value) {
      throw new BadRequestException('Введите API-ключ');
    }

    const encrypted = this.encryptSecret(value);
    const maskedValue = this.maskSecret(value);

    const item = await this.prisma.externalProviderCredential.upsert({
      where: {
        userId_provider: {
          userId,
          provider,
        },
      },
      update: {
        ...encrypted,
        maskedValue,
        isActive: true,
      },
      create: {
        userId,
        provider,
        ...encrypted,
        maskedValue,
        isActive: true,
      },
      select: {
        id: true,
        provider: true,
        maskedValue: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        lastUsedAt: true,
        lastValidatedAt: true,
      },
    });

    return this.serialize(item);
  }

  async getDecryptedSecret(userId: string, providerRaw: string) {
    const provider = this.normalizeProvider(providerRaw);

    const item = await this.prisma.externalProviderCredential.findFirst({
      where: {
        userId,
        provider,
        isActive: true,
      },
      select: {
        id: true,
        encryptedSecret: true,
        secretIv: true,
        secretAuthTag: true,
      },
    });

    if (!item) {
      return null;
    }

    const secret = this.decryptSecret({
      encryptedSecret: item.encryptedSecret,
      secretIv: item.secretIv,
      secretAuthTag: item.secretAuthTag,
    });

    await this.prisma.externalProviderCredential.update({
      where: { id: item.id },
      data: {
        lastUsedAt: new Date(),
      },
    });

    return secret;
  }
}
