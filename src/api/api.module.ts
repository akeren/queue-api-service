import { Module } from '@nestjs/common';
import { QueueController } from './controllers';

@Module({
  controllers: [QueueController],
})
export class ApiModule {}
