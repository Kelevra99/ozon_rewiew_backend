import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../common/authenticated-user.interface';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UsersService } from './users.service';
import { UpdateReplySettingsDto } from './dto/update-reply-settings.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  me(@CurrentUser() user: JwtUserPayload) {
    return this.usersService.me(user.sub);
  }

  @Patch('me/reply-settings')
  updateReplySettings(
    @CurrentUser() user: JwtUserPayload,
    @Body() dto: UpdateReplySettingsDto,
  ) {
    return this.usersService.updateReplySettings(user.sub, dto);
  }
}
