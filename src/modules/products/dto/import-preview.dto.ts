import { IsOptional, IsString } from 'class-validator';

export class ImportPreviewDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  originalFilename?: string;
}
