import { IsOptional, IsString } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  name?: string;
}
