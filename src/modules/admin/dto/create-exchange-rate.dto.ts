import { Type } from 'class-transformer';
import { IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateExchangeRateDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 6 })
  @Min(0.000001)
  rate!: number;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}
