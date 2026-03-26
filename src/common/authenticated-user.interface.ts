import { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface JwtUserPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}
