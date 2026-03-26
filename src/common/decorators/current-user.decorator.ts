import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtUserPayload } from '../authenticated-user.interface';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtUserPayload | null => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: JwtUserPayload }>();
    return req.user ?? null;
  },
);
