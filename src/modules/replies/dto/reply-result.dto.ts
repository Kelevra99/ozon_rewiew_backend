import { IsIn, IsOptional, IsString } from 'class-validator';

export class ReplyResultDto {
  @IsString()
  reviewLogId!: string;

  @IsString()
  @IsIn(['inserted', 'posted', 'skipped', 'failed', 'canceled'])
  status!: 'inserted' | 'posted' | 'skipped' | 'failed' | 'canceled';

  @IsOptional()
  @IsString()
  finalReply?: string;

  @IsOptional()
  @IsString()
  errorText?: string;
}
