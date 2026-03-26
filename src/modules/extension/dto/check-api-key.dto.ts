import { IsNotEmpty, IsString } from 'class-validator';

export class CheckApiKeyDto {
  @IsString()
  @IsNotEmpty()
  apiKey!: string;
}
