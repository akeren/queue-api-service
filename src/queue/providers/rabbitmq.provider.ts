import * as amqplib from 'amqplib';
import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IQueueProvider,
  QueueProviderConfig,
  PublishResult,
  QueueMessage,
  ReceivedMessage,
  MessageHandler,
} from '../interfaces';

/**
 * RabbitMQ Queue Provider Implementation
 * Supports standard queues with acknowledgment
 */
export class RabbitMqQueueProvider implements IQueueProvider {
  readonly providerType = 'rabbitmq';
  private readonly logger = new Logger(RabbitMqQueueProvider.name);
  private connection: amqplib.ChannelModel | null = null;
  private channel: amqplib.Channel | null = null;
  private connected = false;
  private readonly consumerTags = new Map<string, string>();
  private readonly createdQueues = new Set<string>();

  constructor(private readonly config: QueueProviderConfig) {
    this.ensureValidConfig(this.config);
  }

  /**
   * Initialize the RabbitMQ connection
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    this.logger.log('Connecting to RabbitMQ...');

    const connectionUrl = this.config.connectionUrl!;

    try {
      this.connection = await amqplib.connect(connectionUrl);
      this.channel = await this.connection.createChannel();

      // Set prefetch for fair dispatch
      await this.channel.prefetch(this.config.maxMessages || 10);

      // Handle connection events
      this.connection.on('error', (err: Error) => {
        this.logger.error('RabbitMQ connection error:', err);

        this.connected = false;
      });

      this.connection.on('close', () => {
        this.logger.warn('RabbitMQ connection closed');
        this.connected = false;
      });

      this.connected = true;
      this.logger.log('Connected to RabbitMQ successfully');
    } catch (error) {
      this.logger.error('Failed to connect to RabbitMQ:', error);

      throw error;
    }
  }

  /**
   * Disconnect from RabbitMQ and clean up resources
   * @returns Promise that resolves when disconnected
   * @throws Error if disconnection fails
   */
  async disconnect(): Promise<void> {
    this.logger.log('Disconnecting from RabbitMQ...');

    try {
      // Cancel all consumers
      for (const [queueName, consumerTag] of this.consumerTags) {
        if (this.channel) {
          await this.channel.cancel(consumerTag);
          this.logger.log(`Cancelled consumer for queue: ${queueName}`);
        }
      }

      this.consumerTags.clear();

      if (this.channel) {
        await this.channel.close();
        this.channel = null;
      }

      if (this.connection) {
        await this.connection.close();
        this.connection = null;
      }

      this.connected = false;
      this.createdQueues.clear();

      this.logger.log('Disconnected from RabbitMQ');
    } catch (error) {
      this.logger.error('Error disconnecting from RabbitMQ:', error);

      throw new InternalServerErrorException(
        'Error disconnecting from RabbitMQ',
      );
    }
  }

  /**
   * Check if the RabbitMQ provider is connected
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected && this.channel !== null;
  }

  /**
   * Parse the content of a RabbitMQ message
   * @param content - The message content as a Buffer
   * @param properties - The message properties
   * @returns An object containing the message id, body, and optional attributes
   */
  private parseMessageContent<T>(
    content: Buffer,
    properties: amqplib.MessageProperties,
  ): { id: string; body: T; attributes?: Record<string, string> } {
    try {
      const parsed = JSON.parse(content.toString()) as { id?: string; body: T };

      const id = parsed.id || (properties.messageId as string) || randomUUID();

      const attributes = properties.headers
        ? Object.fromEntries(
            Object.entries(properties.headers).map(([key, value]) => [
              key,
              String(value),
            ]),
          )
        : undefined;

      return { id, body: parsed.body, attributes };
    } catch (error) {
      this.logger.error('Failed to parse message content:', error);

      // Fallback: treat entire content as body string
      const id = (properties.messageId as string) || randomUUID();

      const attributes = properties.headers
        ? Object.fromEntries(
            Object.entries(properties.headers).map(([key, value]) => [
              key,
              String(value),
            ]),
          )
        : undefined;

      return { id, body: content.toString() as T, attributes };
    }
  }

  /**
   * Publish a message to the specified queue
   * @param queueName - The name of the queue
   * @param message - The message to publish
   * @returns Publish result with message ID and success status
   */
  async publish<T>(
    queueName: string,
    message: QueueMessage<T>,
  ): Promise<PublishResult> {
    this.ensureConnected();

    await this.ensureQueue(queueName);

    const messageId = message.id || randomUUID();

    const messageBody = JSON.stringify({ id: messageId, body: message.body });

    const headers: Record<string, unknown> = { ...(message.attributes || {}) };

    if (message.delaySeconds && message.delaySeconds > 0) {
      // Note: Requires rabbitmq_delayed_message_exchange plugin
      this.logger.warn(
        `Delay (${message.delaySeconds}s) for message ${messageId} requires rabbitmq_delayed_message_exchange plugin; may be ignored if not installed.`,
      );
      headers['x-delay'] = message.delaySeconds * 1000;
    }

    const options: amqplib.Options.Publish = {
      persistent: true,
      messageId,
      headers,
    };

    try {
      const success = this.channel!.sendToQueue(
        queueName,
        Buffer.from(messageBody),
        options,
      );

      this.logger.debug(`Published message ${messageId} to ${queueName}`);

      return {
        messageId,
        success,
      };
    } catch (error) {
      this.logger.error(`Error publishing message to ${queueName}:`, error);
      throw error;
    }
  }

  /**
   * Publish a batch of messages to the specified queue
   * @param queueName - The name of the queue
   * @param messages - Array of messages to publish
   * @returns Array of publish results with message IDs and success statuses
   */
  async publishBatch<T>(
    queueName: string,
    messages: QueueMessage<T>[],
  ): Promise<PublishResult[]> {
    // Sequential publishes to ensure per-message confirmations
    const results: PublishResult[] = [];

    for (const message of messages) {
      const result = await this.publish(queueName, message);
      results.push(result);
    }

    this.logger.debug(
      `Published batch of ${messages.length} messages to ${queueName}`,
    );

    return results;
  }

  /**
   * Subscribe to messages from the specified queue
   * @param queueName - The name of the queue
   * @param handler - The message handler function
   * @returns Promise that resolves when subscription is set up
   */
  async subscribe<T>(
    queueName: string,
    handler: MessageHandler<T>,
  ): Promise<void> {
    this.ensureConnected();

    if (this.consumerTags.has(queueName)) {
      this.logger.warn(`Already subscribed to queue: ${queueName}`);

      throw new ConflictException(`Already subscribed to queue: ${queueName}`);
    }

    await this.ensureQueue(queueName);

    const consumer = await this.channel!.consume(
      queueName,
      (msg: amqplib.ConsumeMessage | null) => {
        if (!msg) return;

        const processMessage = async (): Promise<void> => {
          try {
            const { id, body, attributes } = this.parseMessageContent(
              msg.content,
              msg.properties,
            );

            const receivedMessage: ReceivedMessage<T> = {
              id,
              body: body as T,
              receiptHandle: msg.fields.deliveryTag.toString(),
              receivedAt: new Date(),
              queueName,
              attributes,
            };

            await handler(receivedMessage);

            // Acknowledge after successful processing
            this.channel!.ack(msg);

            this.logger.debug(
              `Processed and acknowledged message ${id} from ${queueName}`,
            );
          } catch (error) {
            this.logger.error(
              `Error processing message ${msg.fields.deliveryTag}:`,
              error,
            );

            // Negative acknowledge - requeue the message
            this.channel!.nack(msg, false, true);
          }
        };

        void processMessage();
      },
      { noAck: false },
    );

    this.consumerTags.set(queueName, consumer.consumerTag);
    this.logger.log(`Subscribed to queue: ${queueName}`);
  }

  /**
   * Unsubscribe from a queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves when unsubscribed
   */
  async unsubscribe(queueName: string): Promise<void> {
    const consumerTag = this.consumerTags.get(queueName);

    if (consumerTag && this.channel) {
      await this.channel.cancel(consumerTag);

      this.consumerTags.delete(queueName);

      this.logger.log(`Unsubscribed from queue: ${queueName}`);
    }
  }

  /**
   * Receive messages from the specified queue
   * @param queueName - The name of the queue
   * @param maxMessages - Maximum number of messages to receive
   * @returns Array of received messages
   */
  async receive<T>(
    queueName: string,
    maxMessages?: number,
  ): Promise<ReceivedMessage<T>[]> {
    this.ensureConnected();

    await this.ensureQueue(queueName);

    const messages: ReceivedMessage<T>[] = [];
    const limit = maxMessages || this.config.maxMessages || 10;

    for (let i = 0; i < limit; i++) {
      const msg = await this.channel!.get(queueName, { noAck: false });

      if (!msg) break;

      const { id, body, attributes } = this.parseMessageContent(
        msg.content,
        msg.properties,
      );

      messages.push({
        id,
        body: body as T,
        receiptHandle: msg.fields.deliveryTag.toString(),
        receivedAt: new Date(),
        queueName,
        attributes,
      });
    }

    this.logger.debug(`Received ${messages.length} messages from ${queueName}`);

    return messages;
  }

  /**
   * Acknowledge a message from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandle - The receipt handle of the message
   * @returns Promise that resolves when the message is acknowledged
   */
  acknowledge(queueName: string, receiptHandle: string): Promise<void> {
    this.ensureConnected();

    const deliveryTag = parseInt(receiptHandle, 10);
    // Construct minimal message for single ack
    this.channel!.ack({ fields: { deliveryTag } } as amqplib.ConsumeMessage);

    this.logger.debug(`Acknowledged message from ${queueName}`);

    return Promise.resolve();
  }

  /**
   * Acknowledge a batch of messages from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandles - Array of receipt handles of the messages
   * @returns Promise that resolves when the messages are acknowledged
   */
  async acknowledgeBatch(
    queueName: string,
    receiptHandles: string[],
  ): Promise<void> {
    // Parallel acks for efficiency (sync operations)
    await Promise.all(
      receiptHandles.map((handle) => this.acknowledge(queueName, handle)),
    );

    this.logger.debug(
      `Acknowledged batch of ${receiptHandles.length} messages from ${queueName}`,
    );
  }

  /**
   * Create a new queue
   * @param queueName - The name of the queue
   * @param options - Optional queue options
   * @returns The name of the created queue
   */
  async createQueue(
    queueName: string,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.ensureConnected();

    const queueOptions: amqplib.Options.AssertQueue = {
      durable: true,
      ...options,
    };

    // Basic validation for common numeric options
    if (options?.messageRetentionPeriod) {
      const mrp = Number(options.messageRetentionPeriod);

      if (isNaN(mrp) || mrp < 0) {
        throw new BadRequestException(
          'messageRetentionPeriod must be a non-negative number',
        );
      }
    }

    if (options?.deadLetterExchange) {
      if (typeof options.deadLetterExchange !== 'string') {
        throw new BadRequestException('deadLetterExchange must be a string');
      }
    }

    await this.channel!.assertQueue(queueName, queueOptions);
    this.createdQueues.add(queueName);

    this.logger.log(`Created/Ensured queue: ${queueName}`);

    return queueName;
  }

  /**
   * Delete a queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves when the queue is deleted
   */
  async deleteQueue(queueName: string): Promise<void> {
    this.ensureConnected();

    await this.channel!.deleteQueue(queueName);

    this.createdQueues.delete(queueName);

    this.logger.log(`Deleted queue: ${queueName}`);
  }

  /**
   * Get the URL of the specified queue
   * @param queueName - The name of the queue
   * @returns The URL of the queue
   */
  getQueueUrl(queueName: string): Promise<string> {
    // RabbitMQ doesn't use URLs for queues, just return the queue name
    return Promise.resolve(queueName);
  }

  /**
   * Perform a health check on the RabbitMQ provider
   * @returns Object indicating health status and details
   */
  healthCheck(): Promise<{
    healthy: boolean;
    details?: Record<string, unknown>;
  }> {
    try {
      this.ensureConnected();

      this.logger.log('RabbitMQ health check passed');

      return Promise.resolve({
        healthy: true,
        details: {
          provider: this.providerType,
          connectionUrl: this.config.connectionUrl?.replace(
            /\/\/.*:.*@/,
            '//*****:*****@',
          ),
          queueCount: this.createdQueues.size,
        },
      });
    } catch (error) {
      this.logger.error('RabbitMQ health check failed:', error);

      return Promise.resolve({
        healthy: false,
        details: {
          provider: this.providerType,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /**
   * Ensure the RabbitMQ client is connected
   * @throws Error if the client is not connected
   */
  private ensureConnected(): void {
    if (!this.isConnected()) {
      this.logger.error('RabbitMQ client is not connected');

      throw new InternalServerErrorException(
        'RabbitMQ client is not connected',
      );
    }

    this.logger.debug('RabbitMQ client is connected');
  }

  /**
   * Ensure the specified queue exists, creating it if necessary
   * @param queueName - The name of the queue
   * @returns Promise that resolves when the queue is ensured
   */
  private async ensureQueue(queueName: string): Promise<void> {
    if (!this.createdQueues.has(queueName)) {
      this.logger.debug(
        `Queue not found in createdQueues set. Creating queue: ${queueName}`,
      );

      await this.createQueue(queueName);
    }
  }

  /**
   * Validate the RabbitMQ provider configuration
   * @param config - The queue provider configuration
   * @throws BadRequestException if the configuration is invalid
   */
  private ensureValidConfig(config: QueueProviderConfig): void {
    if (!config.connectionUrl) {
      throw new BadRequestException(
        'connectionUrl is required for RabbitMQ provider',
      );
    }

    if (config.maxMessages && config.maxMessages < 1) {
      throw new BadRequestException('maxMessages must be at least 1');
    }
  }
}
