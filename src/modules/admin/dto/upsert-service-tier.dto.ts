import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class UpsertServiceTierDto {
  @IsString()
  @IsIn(['standard', 'advanced', 'expert'])
  code!: 'standard' | 'advanced' | 'expert';

  @IsString()
  title!: string;

  @IsString()
  openAiModel!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  inputPriceUsdPer1m!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  outputPriceUsdPer1m!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0)
  cachedInputPriceUsdPer1m?: number;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}
