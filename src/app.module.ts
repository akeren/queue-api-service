import { Module, Logger, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ApiModule } from './api/api.module';
import { queueConfig } from './config';
import { QueueModule, QueueModuleOptions } from './queue';
import { APP_PIPE } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [queueConfig],
    }),
    QueueModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const config = configService.get<QueueModuleOptions>('queue');

        if (!config) {
          Logger.error(
            'Queue configuration not found in environment variables',
          );

          throw new Error('Queue configuration not found');
        }

        return config;
      },
      inject: [ConfigService],
    }),
    ApiModule,
  ],
  controllers: [],
  providers: [
    {
      provide: 'APP_LOGGER',
      useValue: new Logger('AppModule'),
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    },
  ],
})
export class AppModule {}
