import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TonePreset } from '@prisma/client';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEnum(TonePreset)
  defaultTone?: TonePreset;

  @IsOptional()
  @IsString()
  toneNotes?: string;

  @IsOptional()
  @IsString()
  brandRules?: string;
}
