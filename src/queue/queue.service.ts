import { Injectable, Logger } from '@nestjs/common';
import { QueueProviderFactory } from './providers';
import {
  QueueMessage,
  ReceivedMessage,
  MessageHandler,
  PublishResult,
} from './interfaces';

/**
 * Queue Service
 *
 * Main service for interacting with queue providers.
 * Provides a unified interface for publishing and subscribing to messages.
 * Supports multiple providers running simultaneously.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(private readonly providerFactory: QueueProviderFactory) {}

  /**
   * Publish a message to a queue
   *
   * @param queueName - The name of the queue
   * @param message - The message to publish
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async publish<T>(
    queueName: string,
    message: QueueMessage<T>,
    providerName?: string,
  ): Promise<PublishResult> {
    const provider = await this.providerFactory.getProvider(providerName);

    this.logger.debug(
      `Publishing message to ${queueName} via ${provider.providerType}`,
    );

    return provider.publish(queueName, message);
  }

  /**
   * Publish multiple messages to a queue
   *
   * @param queueName - The name of the queue
   * @param messages - The messages to publish
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async publishBatch<T>(
    queueName: string,
    messages: QueueMessage<T>[],
    providerName?: string,
  ): Promise<PublishResult[]> {
    const provider = await this.providerFactory.getProvider(providerName);

    this.logger.debug(
      `Publishing ${messages.length} messages to ${queueName} via ${provider.providerType}`,
    );

    return provider.publishBatch(queueName, messages);
  }

  /**
   * Subscribe to messages from a queue
   *
   * @param queueName - The name of the queue
   * @param handler - The message handler function
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async subscribe<T>(
    queueName: string,
    handler: MessageHandler<T>,
    providerName?: string,
  ): Promise<void> {
    const provider = await this.providerFactory.getProvider(providerName);

    this.logger.log(`Subscribing to ${queueName} via ${provider.providerType}`);

    return provider.subscribe(queueName, handler);
  }

  /**
   * Unsubscribe from a queue
   *
   * @param queueName - The name of the queue
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async unsubscribe(queueName: string, providerName?: string): Promise<void> {
    const provider = await this.providerFactory.getProvider(providerName);

    this.logger.log(
      `Unsubscribing from ${queueName} via ${provider.providerType}`,
    );

    return provider.unsubscribe(queueName);
  }

  /**
   * Receive messages from a queue (manual pull)
   *
   * @param queueName - The name of the queue
   * @param maxMessages - Maximum number of messages to receive
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async receive<T>(
    queueName: string,
    maxMessages?: number,
    providerName?: string,
  ): Promise<ReceivedMessage<T>[]> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.receive(queueName, maxMessages);
  }

  /**
   * Acknowledge a message
   *
   * @param queueName - The name of the queue
   * @param receiptHandle - The receipt handle of the message
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async acknowledge(
    queueName: string,
    receiptHandle: string,
    providerName?: string,
  ): Promise<void> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.acknowledge(queueName, receiptHandle);
  }

  /**
   * Acknowledge multiple messages
   *
   * @param queueName - The name of the queue
   * @param receiptHandles - The receipt handles of the messages
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async acknowledgeBatch(
    queueName: string,
    receiptHandles: string[],
    providerName?: string,
  ): Promise<void> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.acknowledgeBatch(queueName, receiptHandles);
  }

  /**
   * Create a queue
   *
   * @param queueName - The name of the queue
   * @param options - Optional queue creation options
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async createQueue(
    queueName: string,
    options?: Record<string, unknown>,
    providerName?: string,
  ): Promise<string> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.createQueue(queueName, options);
  }

  /**
   * Delete a queue
   *
   * @param queueName - The name of the queue
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async deleteQueue(queueName: string, providerName?: string): Promise<void> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.deleteQueue(queueName);
  }

  /**
   * Get queue URL
   *
   * @param queueName - The name of the queue
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async getQueueUrl(queueName: string, providerName?: string): Promise<string> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.getQueueUrl(queueName);
  }

  /**
   * Health check for a specific provider
   *
   * @param providerName - Optional provider name (uses default if not specified)
   */
  async healthCheck(
    providerName?: string,
  ): Promise<{ healthy: boolean; details?: Record<string, unknown> }> {
    const provider = await this.providerFactory.getProvider(providerName);

    return provider.healthCheck();
  }

  /**
   * Health check for all providers
   */
  async healthCheckAll(): Promise<
    Record<string, { healthy: boolean; details?: Record<string, unknown> }>
  > {
    return this.providerFactory.healthCheckAll();
  }

  /**
   * Get all registered provider names
   */
  getProviderNames(): string[] {
    return this.providerFactory.getProviderNames();
  }

  /**
   * Publish to all registered providers
   * Useful for fanout scenarios
   *
   * @param queueName - The name of the queue
   * @param message - The message to publish
   */
  async publishToAll<T>(
    queueName: string,
    message: QueueMessage<T>,
  ): Promise<Record<string, PublishResult>> {
    const results: Record<string, PublishResult> = {};

    for (const providerName of this.getProviderNames()) {
      try {
        results[providerName] = await this.publish(
          queueName,
          message,
          providerName,
        );
      } catch (error) {
        this.logger.error(
          `Failed to publish to provider ${providerName}:`,
          error,
        );

        results[providerName] = {
          messageId: '',
          success: false,
        };
      }
    }

    return results;
  }
}
