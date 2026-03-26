import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateReplyDto {
  @IsString()
  reviewExternalId!: string;

  @IsString()
  marketplace!: string;

  @IsOptional()
  @IsString()
  productName?: string;

  @IsOptional()
  @IsObject()
  productMeta?: Record<string, unknown>;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  reviewText?: string;

  @IsOptional()
  @IsString()
  reviewDate?: string;

  @IsOptional()
  @IsString()
  authorName?: string;

  @IsOptional()
  @IsString()
  existingSellerReply?: string;

  @IsOptional()
  @IsString()
  @IsIn(['standard', 'advanced', 'expert'])
  mode: 'standard' | 'advanced' | 'expert' = 'advanced';

  @IsOptional()
  @IsString()
  pageUrl?: string;

  @IsOptional()
  @IsObject()
  domContext?: Record<string, unknown>;
}