import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@CurrentUser() user: JwtUserPayload, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(user.sub, dto.name);
  }

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: JwtUserPayload) {
    return this.apiKeysService.list(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/deactivate')
  async deactivate(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return this.apiKeysService.deactivate(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id/activate')
  async activate(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return this.apiKeysService.activate(user.sub, id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  async remove(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return this.apiKeysService.remove(user.sub, id);
  }
}
