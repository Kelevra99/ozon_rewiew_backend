import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@CurrentUser() user: JwtUserPayload) {
    return this.apiKeysService.create(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: JwtUserPayload) {
    return this.apiKeysService.list(user.sub);
  }
}
