import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('history')
  history(
    @CurrentUser() user: JwtUserPayload,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const pageNumber = Math.max(Number(page) || 1, 1);
    const limitNumber = Math.min(Math.max(Number(limit) || 50, 1), 100);

    return this.reviewsService.history(user.sub, pageNumber, limitNumber);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtUserPayload, @Param('id') reviewId: string) {
    return this.reviewsService.detail(user.sub, reviewId);
  }
}
