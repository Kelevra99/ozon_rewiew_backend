import * as bcrypt from 'bcryptjs';

export async function hashPassword(password: string, saltRounds: number): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

export async function comparePassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
