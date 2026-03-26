import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReviewsService } from './reviews.service';

@Controller('reviews')
@UseGuards(JwtAuthGuard)
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Get('history')
  history(@CurrentUser() user: JwtUserPayload) {
    return this.reviewsService.history(user.sub);
  }

  @Get(':id')
  detail(@CurrentUser() user: JwtUserPayload, @Param('id') reviewId: string) {
    return this.reviewsService.detail(user.sub, reviewId);
  }
}
