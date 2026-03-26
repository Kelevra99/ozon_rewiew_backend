import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UserRole, WalletCurrency } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { comparePassword, hashPassword } from '../../common/password.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existing) {
      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: dto.email.toLowerCase(),
          name: dto.name,
          passwordHash: await hashPassword(dto.password, saltRounds),
          role: UserRole.user,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          defaultTone: true,
          toneNotes: true,
          brandRules: true,
        },
      });

      await tx.wallet.create({
        data: {
          userId: created.id,
          currency: WalletCurrency.RUB,
        },
      });

      return created;
    });

    return user;
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Пользователь деактивирован');
    }

    const isValid = await comparePassword(dto.password, user.passwordHash);

    if (!isValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        defaultTone: true,
        toneNotes: true,
        brandRules: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Пользователь не найден');
    }

    return user;
  }
}
