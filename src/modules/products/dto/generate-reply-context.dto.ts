import { IsIn, IsString } from 'class-validator';

export class GenerateReplyContextDto {
  @IsString()
  @IsIn(['standard', 'advanced', 'expert'])
  mode!: 'standard' | 'advanced' | 'expert';
}
