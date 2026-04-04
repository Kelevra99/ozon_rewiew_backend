import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateManualReplyDto {
  @IsString()
  productId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  reviewText?: string;

  @IsOptional()
  @IsString()
  authorName?: string;

  @IsOptional()
  @IsString()
  reviewDate?: string;

  @IsOptional()
  @IsString()
  @IsIn(['standard', 'advanced', 'expert'])
  mode: 'standard' | 'advanced' | 'expert' = 'advanced';
}
