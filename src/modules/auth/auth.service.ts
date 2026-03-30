import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole, WalletCurrency } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomInt } from 'crypto';
import { Resend } from 'resend';
import { PrismaService } from '../../prisma/prisma.service';
import { comparePassword, hashPassword } from '../../common/password.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

type AuthUserShape = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
  emailVerified: boolean;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private getVerificationTtlMinutes() {
    return Number(process.env.EMAIL_VERIFICATION_TTL_MINUTES || 15);
  }

  private getResendCooldownSeconds() {
    return Number(process.env.EMAIL_VERIFICATION_RESEND_COOLDOWN_SECONDS || 60);
  }

  private generateVerificationCode() {
    return String(randomInt(100000, 1000000));
  }

  private hashVerificationCode(code: string) {
    return createHash('sha256').update(code).digest('hex');
  }

  private async buildAuthResponse(user: AuthUserShape) {
    const accessToken = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
      },
    };
  }

  private async sendVerificationEmail(args: {
    email: string;
    name: string;
    code: string;
  }) {
    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;

    if (!apiKey) {
      throw new InternalServerErrorException('Не настроен RESEND_API_KEY');
    }

    if (!from) {
      throw new InternalServerErrorException('Не настроен EMAIL_FROM');
    }

    const resend = new Resend(apiKey);
    const ttlMinutes = this.getVerificationTtlMinutes();

    const html = `
      <div style="font-family: Inter, Arial, sans-serif; color: #111827; line-height: 1.6;">
        <h2 style="margin: 0 0 16px;">Подтверждение почты в Finerox</h2>
        <p style="margin: 0 0 12px;">Здравствуйте${args.name ? `, ${args.name}` : ''}.</p>
        <p style="margin: 0 0 12px;">
          Ваш код подтверждения:
        </p>
        <div style="margin: 16px 0; font-size: 32px; font-weight: 700; letter-spacing: 6px;">
          ${args.code}
        </div>
        <p style="margin: 0 0 12px;">
          Код действует ${ttlMinutes} минут.
        </p>
        <p style="margin: 0; color: #6B7280;">
          Если вы не регистрировались в Finerox, просто проигнорируйте это письмо.
        </p>
      </div>
    `;

    const { error } = await resend.emails.send({
      from,
      to: [args.email],
      subject: 'Код подтверждения Finerox',
      html,
    });

    if (error) {
      throw new InternalServerErrorException(`Resend error: ${error.message}`);
    }
  }

  async register(dto: RegisterDto) {
    const email = this.normalizeEmail(dto.email);

    const existing = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existing) {
      if (!existing.emailVerified) {
        throw new BadRequestException(
          'Почта уже зарегистрирована, но ещё не подтверждена. Введите код или запросите его повторно.',
        );
      }

      throw new BadRequestException('Пользователь с таким email уже существует');
    }

    const saltRounds = Number(process.env.BCRYPT_SALT_ROUNDS || 10);
    const code = this.generateVerificationCode();
    const codeHash = this.hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + this.getVerificationTtlMinutes() * 60 * 1000);
    const now = new Date();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: dto.name,
          passwordHash: await hashPassword(dto.password, saltRounds),
          role: UserRole.user,
          isActive: true,
          emailVerified: false,
          emailVerificationCodeHash: codeHash,
          emailVerificationExpiresAt: expiresAt,
          emailVerificationSentAt: now,
          emailVerificationAttempts: 0,
        },
        select: {
          id: true,
          email: true,
          name: true,
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

    let verificationEmailSent = true;

    try {
      await this.sendVerificationEmail({
        email: user.email,
        name: user.name,
        code,
      });
    } catch (error) {
      verificationEmailSent = false;
      console.error('Email verification send failed:', error);
    }

    return {
      requiresEmailVerification: true,
      email: user.email,
      verificationEmailSent,
    };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const email = this.normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerified: true,
        emailVerificationCodeHash: true,
        emailVerificationExpiresAt: true,
        emailVerificationAttempts: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Пользователь с таким email не найден');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Пользователь деактивирован');
    }

    if (user.emailVerified) {
      return this.buildAuthResponse(user);
    }

    if (!user.emailVerificationCodeHash || !user.emailVerificationExpiresAt) {
      throw new BadRequestException('Код подтверждения не найден. Запросите новый код.');
    }

    if (user.emailVerificationExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Код истёк. Запросите новый код.');
    }

    if (user.emailVerificationAttempts >= 10) {
      throw new BadRequestException('Превышено число попыток. Запросите новый код.');
    }

    const codeHash = this.hashVerificationCode(dto.code);

    if (codeHash !== user.emailVerificationCodeHash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          emailVerificationAttempts: {
            increment: 1,
          },
        },
      });

      throw new BadRequestException('Неверный код подтверждения');
    }

    const verifiedUser = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        emailVerificationCodeHash: null,
        emailVerificationExpiresAt: null,
        emailVerificationSentAt: null,
        emailVerificationAttempts: 0,
        lastLoginAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        emailVerified: true,
      },
    });

    return this.buildAuthResponse(verifiedUser);
  }

  async resendVerification(dto: ResendVerificationDto) {
    const email = this.normalizeEmail(dto.email);

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        name: true,
        emailVerified: true,
        isActive: true,
        emailVerificationSentAt: true,
      },
    });

    if (!user) {
      throw new BadRequestException('Пользователь с таким email не найден');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Пользователь деактивирован');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Почта уже подтверждена');
    }

    const cooldownSeconds = this.getResendCooldownSeconds();

    if (user.emailVerificationSentAt) {
      const diffSeconds = Math.floor((Date.now() - user.emailVerificationSentAt.getTime()) / 1000);
      if (diffSeconds < cooldownSeconds) {
        throw new BadRequestException(
          `Повторная отправка будет доступна через ${cooldownSeconds - diffSeconds} сек.`,
        );
      }
    }

    const code = this.generateVerificationCode();
    const codeHash = this.hashVerificationCode(code);
    const expiresAt = new Date(Date.now() + this.getVerificationTtlMinutes() * 60 * 1000);
    const now = new Date();

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerificationCodeHash: codeHash,
        emailVerificationExpiresAt: expiresAt,
        emailVerificationSentAt: now,
        emailVerificationAttempts: 0,
      },
    });

    await this.sendVerificationEmail({
      email: user.email,
      name: user.name,
      code,
    });

    return {
      ok: true,
      email: user.email,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: this.normalizeEmail(dto.email) },
    });

    if (!user) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    if (!user.isActive) {
      throw new ForbiddenException('Пользователь деактивирован');
    }

    if (!user.emailVerified) {
      throw new ForbiddenException('Почта не подтверждена');
    }

    const isValid = await comparePassword(dto.password, user.passwordHash);

    if (!isValid) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.buildAuthResponse({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      emailVerified: user.emailVerified,
    });
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
        emailVerified: true,
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
