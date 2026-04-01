import { IsString, MinLength, MaxLength } from 'class-validator';

export class SetUserPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
