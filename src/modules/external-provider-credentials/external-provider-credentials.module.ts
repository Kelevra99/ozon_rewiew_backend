import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExternalProviderCredentialsController } from './external-provider-credentials.controller';
import { ExternalProviderCredentialsService } from './external-provider-credentials.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExternalProviderCredentialsController],
  providers: [ExternalProviderCredentialsService],
  exports: [ExternalProviderCredentialsService],
})
export class ExternalProviderCredentialsModule {}
