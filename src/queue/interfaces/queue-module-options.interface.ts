import {
  InjectionToken,
  ModuleMetadata,
  OptionalFactoryDependency,
  Type,
} from '@nestjs/common';
import { QueueProviderConfig } from './queue-provider.interface';

/**
 * Supported queue provider types
 */
export type QueueProviderType = 'sqs' | 'rabbitmq' | 'in-memory';

/**
 * Configuration for a single queue provider
 */
export interface QueueProviderOptions extends QueueProviderConfig {
  /**
   * The type of queue provider
   */
  type: QueueProviderType;

  /**
   * Whether this is the default provider
   */
  isDefault?: boolean;
}

/**
 * Options for configuring the Queue module
 */
export interface QueueModuleOptions {
  /**
   * Array of queue provider configurations
   * Allows multiple providers to be used simultaneously
   */
  providers: QueueProviderOptions[];

  /**
   * Whether to enable health checks
   */
  enableHealthChecks?: boolean;

  /**
   * Global configuration that applies to all providers
   */
  global?: boolean;
}

/**
 * Factory interface for async module configuration
 */
export interface QueueModuleOptionsFactory {
  createQueueModuleOptions(): Promise<QueueModuleOptions> | QueueModuleOptions;
}

/**
 * Async options for configuring the Queue module
 */
export interface QueueModuleAsyncOptions extends Pick<
  ModuleMetadata,
  'imports'
> {
  /**
   * Whether to make the module global
   */
  isGlobal?: boolean;

  /**
   * Use an existing provider
   */
  useExisting?: Type<QueueModuleOptionsFactory>;

  /**
   * Use a class as the factory
   */
  useClass?: Type<QueueModuleOptionsFactory>;

  /**
   * Use a factory function
   */
  useFactory?: (
    ...args: any[]
  ) => Promise<QueueModuleOptions> | QueueModuleOptions;

  /**
   * Inject dependencies into the factory
   */
  inject?: (InjectionToken | OptionalFactoryDependency)[];
}
