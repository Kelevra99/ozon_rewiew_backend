import { Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { ExtensionService } from './extension.service';

@Controller('extension')
export class ExtensionController {
  constructor(private readonly extensionService: ExtensionService) {}

  @Post('auth/check')
  async check(@Headers('authorization') authorization?: string) {
    const apiKey = this.extractBearerToken(authorization);

    if (!apiKey) {
      throw new UnauthorizedException('Missing Bearer API key');
    }

    return this.extensionService.checkApiKey(apiKey);
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