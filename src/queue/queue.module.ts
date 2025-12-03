import {
  DynamicModule,
  Global,
  Logger,
  Module,
  Provider,
  Type,
} from '@nestjs/common';
import {
  QueueModuleOptions,
  QueueModuleAsyncOptions,
  QueueModuleOptionsFactory,
  QUEUE_MODULE_OPTIONS,
} from './interfaces';
import { QueueProviderFactory } from './providers';
import { QueueService } from './queue.service';

@Global()
@Module({})
export class QueueModule {
  private static readonly logger = new Logger(QueueModule.name);

  /**
   * Register the module with synchronous configuration
   */
  static forRoot(options: QueueModuleOptions): DynamicModule {
    return {
      module: QueueModule,
      global: options.global ?? true,
      providers: [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useValue: options,
        },
        QueueProviderFactory,
        {
          provide: QueueService,
          useFactory: async (factory: QueueProviderFactory) => {
            // Register all providers
            for (const providerOptions of options.providers) {
              await factory.registerProvider(
                providerOptions.name,
                providerOptions,
                providerOptions.isDefault,
              );
            }
            return new QueueService(factory);
          },
          inject: [QueueProviderFactory],
        },
      ],
      exports: [QueueService, QueueProviderFactory],
    };
  }

  /**
   * Register the module with asynchronous configuration
   */
  static forRootAsync(options: QueueModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);
    return {
      module: QueueModule,
      global: options.isGlobal ?? true,
      imports: options.imports || [],
      providers: [
        ...asyncProviders,
        QueueProviderFactory,
        {
          provide: QueueService,
          useFactory: async (
            factory: QueueProviderFactory,
            moduleOptions: QueueModuleOptions,
          ) => {
            // Register all providers
            for (const providerOptions of moduleOptions.providers) {
              await factory.registerProvider(
                providerOptions.name,
                providerOptions,
                providerOptions.isDefault,
              );
            }
            return new QueueService(factory);
          },
          inject: [QueueProviderFactory, QUEUE_MODULE_OPTIONS],
        },
      ],
      exports: [QueueService, QueueProviderFactory],
    };
  }

  private static createAsyncProviders(
    options: QueueModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const useClass = options.useClass as Type<QueueModuleOptionsFactory>;
    const useExisting = options.useExisting as Type<QueueModuleOptionsFactory>;

    if (useClass) {
      return [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useFactory: async (optionsFactory: QueueModuleOptionsFactory) =>
            optionsFactory.createQueueModuleOptions(),
          inject: [useClass],
        },
        {
          provide: useClass,
          useClass: useClass,
        },
      ];
    }

    if (useExisting) {
      return [
        {
          provide: QUEUE_MODULE_OPTIONS,
          useFactory: async (optionsFactory: QueueModuleOptionsFactory) =>
            optionsFactory.createQueueModuleOptions(),
          inject: [useExisting],
        },
      ];
    }

    return [];
  }

  /**
   * Register a feature module for queue operations
   * Useful for module-specific queue configurations
   */
  static forFeature(): DynamicModule {
    return {
      module: QueueModule,
      providers: [],
      exports: [QueueService, QueueProviderFactory],
    };
  }
}
