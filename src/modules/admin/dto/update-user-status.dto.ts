import { Type } from 'class-transformer';
import { IsBoolean } from 'class-validator';

export class UpdateUserStatusDto {
  @Type(() => Boolean)
  @IsBoolean()
  isActive!: boolean;
}
