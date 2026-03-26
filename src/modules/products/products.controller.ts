import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportCommitDto } from './dto/import-commit.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';
import { OptionalJwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';

@Controller('products')
@UseGuards(OptionalJwtAuthGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file'))
  previewImport(
    @Query('userId') queryUserId: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: JwtUserPayload | null,
  ) {
    const userId = this.resolveUserId(user, queryUserId);

    if (!file) {
      throw new BadRequestException('Файл импорта не передан');
    }

    return this.productsService.previewImport(userId, file.originalname, file.buffer);
  }

  @Post('import/commit')
  commitImport(@Body() dto: ImportCommitDto, @CurrentUser() user: JwtUserPayload | null) {
    const userId = this.resolveUserId(user, dto.userId);
    return this.productsService.commitImport(userId, dto);
  }

  @Get()
  list(@Query('userId') queryUserId: string | undefined, @CurrentUser() user: JwtUserPayload | null) {
    const userId = this.resolveUserId(user, queryUserId);
    return this.productsService.list(userId);
  }

  @Patch(':productId')
  update(
    @Param('productId') productId: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: JwtUserPayload | null,
  ) {
    return this.productsService.update(productId, dto, user ?? undefined);
  }

  private resolveUserId(user: JwtUserPayload | null, fallbackUserId?: string) {
    const resolved = user?.sub ?? fallbackUserId;
    if (!resolved) {
      throw new BadRequestException('Не удалось определить userId');
    }

    return resolved;
  }
}
