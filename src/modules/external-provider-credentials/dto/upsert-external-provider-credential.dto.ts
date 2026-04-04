import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpsertExternalProviderCredentialDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  secret!: string;
}
