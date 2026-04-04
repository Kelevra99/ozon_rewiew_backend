import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GenerateReplyDto } from './dto/generate-reply.dto';
import { GenerateManualReplyDto } from './dto/generate-manual-reply.dto';
import { PreviewManualReplyDto } from './dto/preview-manual-reply.dto';
import { ReplyResultDto } from './dto/reply-result.dto';
import { RepliesService } from './replies.service';

@Controller('replies')
export class RepliesController {
  constructor(private readonly repliesService: RepliesService) {}

  @Post('generate')
  generate(
    @Body() dto: GenerateReplyDto,
    @Headers('authorization') authorization?: string,
  ) {
    const apiKey = this.extractBearerToken(authorization);

    if (!apiKey) {
      throw new UnauthorizedException('Missing Bearer API key');
    }

    return this.repliesService.generate(dto, apiKey);
  }

  @UseGuards(JwtAuthGuard)
  @Post('manual/preview')
  previewManual(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: PreviewManualReplyDto,
  ) {
    return this.repliesService.previewManual(user.sub, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('manual/generate')
  generateManual(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: GenerateManualReplyDto,
  ) {
    return this.repliesService.generateManual(user.sub, dto);
  }

  @Post('result')
  result(@Body() dto: ReplyResultDto) {
    return this.repliesService.setResult(dto);
  }

  private extractBearerToken(authorization?: string) {
    if (!authorization) {
      return null;
    }

    const [type, token] = authorization.split(' ');

    if (type !== 'Bearer' || !token) {
      return null;
    }

    return token.trim();
  }
}
