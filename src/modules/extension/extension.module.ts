import { Module } from '@nestjs/common';
import { ExtensionController } from './extension.controller';
import { ExtensionService } from './extension.service';
import { ApiKeysModule } from '../api-keys/api-keys.module';

@Module({
  imports: [ApiKeysModule],
  controllers: [ExtensionController],
  providers: [ExtensionService],
})
export class ExtensionModule {}
