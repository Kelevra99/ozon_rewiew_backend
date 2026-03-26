import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { ServiceTiersService } from './service-tiers.service';

@Module({
  imports: [PrismaModule],
  providers: [ServiceTiersService],
  exports: [ServiceTiersService],
})
export class ServiceTiersModule {}
