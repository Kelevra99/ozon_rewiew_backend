import { ArrayNotEmpty, IsArray, IsOptional, IsString } from 'class-validator';

export class BulkUpdateProductsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds!: string[];

  @IsOptional()
  @IsString()
  brand?: string | null;

  @IsOptional()
  @IsString()
  model?: string | null;

  @IsOptional()
  @IsString()
  productRules?: string | null;

  @IsOptional()
  @IsString()
  annotation?: string | null;
}
