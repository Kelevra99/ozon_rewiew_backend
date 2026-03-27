import { Type } from 'class-transformer';
import { IsEmail, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amountRub!: number;

  @IsOptional()
  @IsEmail()
  receiptEmail?: string;

  @IsOptional()
  @IsString()
  receiptPhone?: string;

  @IsOptional()
  @IsString()
  successUrl?: string;

  @IsOptional()
  @IsString()
  failUrl?: string;
}
