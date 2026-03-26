import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { GenerateReplyDto } from './dto/generate-reply.dto';
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