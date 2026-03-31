import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateReplySettingsDto } from './dto/update-reply-settings.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        defaultTone: true,
        toneNotes: true,
        brandRules: true,
        lastLoginAt: true,
        createdAt: true,
        wallet: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    return user;
  }

  async updateReplySettings(userId: string, dto: UpdateReplySettingsDto) {
    const existing = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!existing) {
      throw new NotFoundException('Пользователь не найден');
    }

    const data: {
      defaultTone?: UpdateReplySettingsDto['defaultTone'];
      toneNotes?: string | null;
    } = {};

    if (Object.prototype.hasOwnProperty.call(dto, 'defaultTone')) {
      data.defaultTone = dto.defaultTone;
    }

    if (Object.prototype.hasOwnProperty.call(dto, 'toneNotes')) {
      data.toneNotes = this.normalizeNullableString(dto.toneNotes);
    }

    return this.prisma.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        defaultTone: true,
        toneNotes: true,
        brandRules: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
  }

  private normalizeNullableString(value?: string | null) {
    if (value === null || value === undefined) {
      return null;
    }

    const cleaned = String(value).trim();
    return cleaned.length ? cleaned : null;
  }
}
