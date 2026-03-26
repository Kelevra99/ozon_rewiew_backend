import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ApiKeysService } from '../api-keys/api-keys.service';

@Injectable()
export class ExtensionService {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  async checkApiKey(apiKey: string) {
    const user = await this.apiKeysService.resolveUserByRawKey(apiKey);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Недействительный API-ключ');
    }

    return {
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      defaults: {
        tonePreset: user.defaultTone,
        toneNotes: user.toneNotes,
      },
      limits: {
        mode: ['standard', 'advanced', 'expert'],
      },
    };
  }
}
