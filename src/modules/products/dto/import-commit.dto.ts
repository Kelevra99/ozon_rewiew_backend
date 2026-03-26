import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TonePreset } from '@prisma/client';

export class ImportCommitDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  draftToken?: string;

  @IsOptional()
  @IsString()
  selectedExtra1?: string;

  @IsOptional()
  @IsString()
  selectedExtra2?: string;

  @IsOptional()
  @IsEnum(TonePreset)
  defaultTonePreset?: TonePreset;

  @IsOptional()
  @IsString()
  defaultToneNotes?: string;

  @IsOptional()
  @IsString()
  defaultProductRules?: string;
}
