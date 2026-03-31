import { IsEnum, IsOptional, IsString } from 'class-validator';
import { TonePreset } from '@prisma/client';

export class UpdateReplySettingsDto {
  @IsOptional()
  @IsEnum(TonePreset)
  defaultTone?: TonePreset;

  @IsOptional()
  @IsString()
  toneNotes?: string;
}
