import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  IQueueProvider,
  QueueProviderConfig,
  QueueProviderOptions,
  QueueProviderType,
} from '../interfaces';
import { SqsQueueProvider } from './sqs.provider';
import { RabbitMqQueueProvider } from './rabbitmq.provider';
import { InMemoryQueueProvider } from './in-memory.provider';

/**
 * Factory for creating queue providers based on configuration
 * Supports multiple providers running simultaneously
 */
@Injectable()
export class QueueProviderFactory implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueProviderFactory.name);
  private readonly providers = new Map<string, IQueueProvider>();
  private defaultProviderName: string | null = null;

  /**
   * Create a queue provider from configuration
   */
  createProvider(options: QueueProviderOptions): IQueueProvider {
    // Validate required options based on type
    this.validateProviderOptions(options);

    const config: QueueProviderConfig = {
      name: options.name,
      queueUrl: options.queueUrl,
      region: options.region,
      endpoint: options.endpoint,
      connectionUrl: options.connectionUrl,
      maxMessages: options.maxMessages,
      visibilityTimeout: options.visibilityTimeout,
      waitTimeSeconds: options.waitTimeSeconds,
      options: options.options,
    };

    switch (options.type) {
      case 'sqs':
        this.logger.log(`Creating SQS provider: ${options.name || 'default'}`);
        return new SqsQueueProvider(config);

      case 'rabbitmq':
        this.logger.log(
          `Creating RabbitMQ provider: ${options.name || 'default'}`,
        );
        return new RabbitMqQueueProvider(config);

      case 'in-memory':
        this.logger.log(
          `Creating In-Memory provider: ${options.name || 'default'}`,
        );
        return new InMemoryQueueProvider(config);

      default:
        this.logger.error(
          `Unknown queue provider type: ${String(options.type)}`,
        );

        throw new BadRequestException(
          `Unknown queue provider type: ${String(options.type)}`,
        );
    }
  }

  /**
   * Validate provider options based on type
   * Throws BadRequestException if validation fails
   * @param options - The provider options to validate
   */
  private validateProviderOptions(options: QueueProviderOptions): void {
    switch (options.type) {
      case 'sqs':
        if (!options.queueUrl && !options.endpoint) {
          throw new BadRequestException(
            'SQS provider requires queueUrl or endpoint',
          );
        }
        if (!options.region && !options.endpoint) {
          throw new BadRequestException(
            'SQS provider requires region or endpoint',
          );
        }
        break;
      case 'rabbitmq':
        if (!options.connectionUrl) {
          throw new BadRequestException(
            'RabbitMQ provider requires connectionUrl',
          );
        }
        break;
      case 'in-memory':
        // No specific validation needed
        break;
      default:
        // This should not happen due to switch in createProvider
        break;
    }
  }

  /**
   * Register a provider instance
   * @param name - Unique name for the provider
   * @param options - Configuration options for the provider
   * @param isDefault - Whether to set this provider as the default
   * @returns Promise that resolves when the provider is registered
   */
  async registerProvider(
    name: string,
    options: QueueProviderOptions,
    isDefault = false,
  ): Promise<void> {
    if (this.providers.has(name)) {
      this.logger.warn(
        `Queue provider with name ${name} is already registered`,
      );

      return;
    }

    this.logger.log(`Creating queue provider: ${name}`);
    const provider = this.createProvider(options);

    this.logger.log(`Connecting queue provider: ${name}`);
    await provider.connect();

    this.logger.log(`Connected queue provider: ${name}`);
    this.providers.set(name, provider);

    if (isDefault || !this.defaultProviderName) {
      if (
        isDefault &&
        this.defaultProviderName &&
        this.defaultProviderName !== name
      ) {
        this.logger.warn(
          `Changing default provider from ${this.defaultProviderName} to ${name}`,
        );
      }
      this.defaultProviderName = name;
    }

    this.logger.log(
      `Registered queue provider: ${name} (type: ${options.type})${isDefault ? ' [default]' : ''}`,
    );
  }

  /**
   * Get a provider by name (lazy connects if needed)
   * @param name - The name of the provider (uses default if not specified)
   * @returns The queue provider instance
   */
  async getProvider(name?: string): Promise<IQueueProvider> {
    const providerName = name || this.defaultProviderName;

    if (!providerName) {
      this.logger.error('No queue provider available');

      throw new BadRequestException('No queue provider available!');
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      this.logger.warn(`Queue provider not found: ${providerName}`);

      throw new NotFoundException(
        `The queue provider '${providerName}' was not found. Available providers: ${this.getProviderNames().join(', ')}`,
      );
    }

    // Lazy connect if not connected
    if (!provider.isConnected()) {
      this.logger.log(`Connecting provider on demand: ${providerName}`);
      await provider.connect();
      this.logger.log(`Connected provider: ${providerName}`);
    }

    return provider;
  }

  /**
   * Get the default provider
   * @returns The default queue provider instance
   */
  async getDefaultProvider(): Promise<IQueueProvider> {
    return this.getProvider();
  }

  /**
   * Get all registered provider names
   * @returns Array of provider names
   */
  getProviderNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Get the provider type by name
   * @param name - The name of the provider (uses default if not specified)
   * @returns The provider type
   */
  async getProviderType(name?: string): Promise<QueueProviderType> {
    const provider = await this.getProvider(name);

    return provider.providerType as QueueProviderType;
  }

  /**
   * Check if a provider exists
   * @param name - The name of the provider
   * @returns True if the provider exists, false otherwise
   */
  hasProvider(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Health check for all providers
   * @returns Record of provider names to their health status
   * { healthy: boolean; details?: Record<string, unknown> }
   */
  async healthCheckAll(): Promise<
    Record<string, { healthy: boolean; details?: Record<string, unknown> }>
  > {
    const healthChecks = Array.from(this.providers.entries()).map(
      async ([name, provider]) => {
        try {
          const result = await provider.healthCheck();
          return { name, result };
        } catch (error) {
          this.logger.error(`Health check failed for provider ${name}:`, error);
          return {
            name,
            result: { healthy: false, details: { error: String(error) } },
          };
        }
      },
    );

    const settledResults = await Promise.allSettled(healthChecks);
    const results: Record<
      string,
      { healthy: boolean; details?: Record<string, unknown> }
    > = {};

    for (const settled of settledResults) {
      if (settled.status === 'fulfilled') {
        const { name, result } = settled.value;
        results[name] = result;
      } else {
        // This shouldn't happen since we catch in the map, but just in case
        this.logger.error('Unexpected health check rejection:', settled.reason);
      }
    }

    return results;
  }

  /**  * Lifecycle hook - on module init
   */
  onModuleInit(): void {
    this.logger.log('Queue provider factory initialized');
  }

  /**  * Lifecycle hook - on module destroy
   * Disconnects all providers
   * Returns a promise that resolves when all providers are disconnected
   */
  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting all queue providers...');

    for (const [name, provider] of this.providers) {
      try {
        await provider.disconnect();

        this.logger.log(`Disconnected provider: ${name}`);
      } catch (error) {
        this.logger.error(`Error disconnecting provider ${name}:`, error);
      }
    }

    this.logger.log('All queue providers disconnected');
    this.providers.clear();
  }
}
