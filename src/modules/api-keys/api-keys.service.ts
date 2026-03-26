import { Injectable } from '@nestjs/common';
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

  async create(userId: string) {
    const plainKey = this.generatePlainKey();
    const keyHash = this.hashKey(plainKey);
    const keyPrefix = plainKey.slice(0, 12);

    const apiKey = await this.prisma.apiKey.create({
      data: {
        userId,
        keyHash,
        keyPrefix,
      },
      select: {
        id: true,
        keyPrefix: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });

    return {
      apiKey,
      plainKey,
    };
  }

  async list(userId: string) {
    return this.prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        keyPrefix: true,
        createdAt: true,
        revokedAt: true,
        lastUsedAt: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
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