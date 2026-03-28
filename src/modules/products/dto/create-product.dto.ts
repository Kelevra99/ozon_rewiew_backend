import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TonePreset } from '@prisma/client';

export class CreateProductDto {
  @IsOptional()
  @IsString()
  article?: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  kit?: string;

  @IsOptional()
  @IsString()
  annotation?: string;

  @IsOptional()
  @IsEnum(TonePreset)
  tonePreset?: TonePreset;

  @IsOptional()
  @IsString()
  toneNotes?: string;

  @IsOptional()
  @IsString()
  productRules?: string;

  @IsOptional()
  @IsString()
  extra1Name?: string;

  @IsOptional()
  @IsString()
  extra1Value?: string;

  @IsOptional()
  @IsString()
  extra2Name?: string;

  @IsOptional()
  @IsString()
  extra2Value?: string;
}
