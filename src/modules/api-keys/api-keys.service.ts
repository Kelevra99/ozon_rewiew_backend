import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ApiKeysService {
  constructor(private readonly prisma: PrismaService) {}

  private generatePlainKey() {
    return `sk_user_${randomBytes(24).toString('hex')}`;
  }

  private hashKey(key: string) {
    return createHash('sha256').update(key).digest('hex');
  }

  private serializeApiKey(apiKey: {
    id: string;
    keyPrefix: string;
    name: string | null;
    createdAt: Date;
    revokedAt: Date | null;
    lastUsedAt: Date | null;
  }) {
    return {
      id: apiKey.id,
      prefix: apiKey.keyPrefix,
      name: apiKey.name,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      isActive: apiKey.revokedAt === null,
    };
  }

  async create(userId: string, name?: string) {
    const plainKey = this.generatePlainKey();
    const keyHash = this.hashKey(plainKey);
    const keyPrefix = plainKey.slice(0, 12);
    const normalizedName = name?.trim() ? name.trim() : null;

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        keyPrefix,
        name: normalizedName,
      },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return {
      apiKey: this.serializeApiKey(apiKey),
      plainKey,
    };
  }

  async list(userId: string) {
    const items = await this.prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return items.map((item) => this.serializeApiKey(item));
  }

  async deactivate(userId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Ключ не найден');
    }

    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return this.serializeApiKey(apiKey);
  }

  async activate(userId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Ключ не найден');
    }

    const apiKey = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: null },
      select: {
        id: true,
        keyPrefix: true,
        name: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return this.serializeApiKey(apiKey);
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.apiKey.findFirst({
      where: { id, userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Ключ не найден');
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    return { success: true };
  }

  async findActiveByPlainKey(plainKey: string) {
    const keyHash = this.hashKey(plainKey);

    const apiKey = await this.prisma.apiKey.findFirst({
      where: {
        keyHash,
        revokedAt: null,
      },
      include: {
        user: true,
      },
    });

    if (!apiKey) {
      return null;
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: { lastUsedAt: new Date() },
    });

    return apiKey;
  }

  async resolveUserByRawKey(plainKey: string) {
    const apiKey = await this.findActiveByPlainKey(plainKey);

    if (!apiKey) {
      return null;
    }

    return apiKey.user;
  }
}
