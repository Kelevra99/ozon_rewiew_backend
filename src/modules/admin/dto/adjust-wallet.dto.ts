import { Type } from 'class-transformer';
import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';

export class AdjustWalletDto {
  @IsString()
  userId!: string;

  @Type(() => Number)
  @IsInt()
  amountMinor!: number;

  @IsString()
  reason!: string;

  @IsOptional()
  @IsObject()
  metaJson?: Record<string, unknown>;
}
