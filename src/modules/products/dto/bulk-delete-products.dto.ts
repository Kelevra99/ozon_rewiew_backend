import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class BulkDeleteProductsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  productIds!: string[];
}
