import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpsertExternalProviderCredentialDto } from './dto/upsert-external-provider-credential.dto';
import { ExternalProviderCredentialsService } from './external-provider-credentials.service';

@Controller('external-provider-credentials')
export class ExternalProviderCredentialsController {
  constructor(
    private readonly externalProviderCredentialsService: ExternalProviderCredentialsService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  async list(@CurrentUser() user: JwtUserPayload) {
    return this.externalProviderCredentialsService.list(user.sub);
  }

  @UseGuards(JwtAuthGuard)
  @Put(':provider')
  async upsert(
    @CurrentUser() user: JwtUserPayload,
    @Param('provider') provider: string,
    @Body() dto: UpsertExternalProviderCredentialDto,
  ) {
    return this.externalProviderCredentialsService.upsert(
      user.sub,
      provider,
      dto.secret,
    );
  }
}
