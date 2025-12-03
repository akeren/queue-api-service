import { randomUUID } from 'crypto';
import { BadRequestException, Logger } from '@nestjs/common';
import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  DeleteMessageBatchCommand,
  CreateQueueCommand,
  DeleteQueueCommand,
  GetQueueUrlCommand,
  ListQueuesCommand,
} from '@aws-sdk/client-sqs';
import {
  IQueueProvider,
  QueueProviderConfig,
  PublishResult,
  QueueMessage,
  ReceivedMessage,
  MessageHandler,
} from '../interfaces';

/**
 * AWS SQS Queue Provider Implementation
 * Supports both standard and FIFO queues
 */
export class SqsQueueProvider implements IQueueProvider {
  readonly providerType = 'sqs';
  private readonly logger = new Logger(SqsQueueProvider.name);
  private client: SQSClient | null = null;
  private connected = false;
  private readonly subscriptions = new Map<string, NodeJS.Timeout>();
  private readonly queueUrlCache = new Map<string, string>();

  constructor(private readonly config: QueueProviderConfig) {
    this.ensureValidConfig(this.config);
  }

  /**
   * Initialize the SQS client and verify connection
   * @returns Promise that resolves when connected
   * @throws Error if connection fails
   */
  async connect(): Promise<void> {
    this.logger.log('Connecting to AWS SQS...');

    const clientConfig: ConstructorParameters<typeof SQSClient>[0] = {
      region: this.config.region,
    };

    // Support LocalStack endpoint for local development
    if (this.config.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
      clientConfig.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'localstack',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'localstack',
      };
    }

    this.client = new SQSClient(clientConfig);

    // Verify connection by listing queues
    const command = new ListQueuesCommand({ MaxResults: 1 });
    await this.client.send(command);

    this.connected = true;
    this.logger.log('Connected to AWS SQS successfully');
  }

  /**
   * Disconnect from AWS SQS and clean up resources
   * @returns Promise that resolves when disconnected
   * @throws Error if disconnection fails
   */
  disconnect(): Promise<void> {
    this.logger.log('Disconnecting from AWS SQS...');

    // Stop all subscriptions
    for (const [queueName, intervalId] of this.subscriptions) {
      clearInterval(intervalId);
      this.logger.log(`Stopped subscription for queue: ${queueName}`);
    }

    this.subscriptions.clear();

    if (this.client) {
      this.client = null;
    }

    this.connected = false;
    this.queueUrlCache.clear();
    this.logger.log('Disconnected from AWS SQS');

    return Promise.resolve();
  }

  /**
   * Check if the provider is connected
   * @returns True if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  /**
   * Create SQS message attributes from a simple key-value map
   * @param attributes - Key-value map of attributes
   * @returns SQS message attributes
   */
  private createMessageAttributes(attributes?: Record<string, string>) {
    return attributes
      ? Object.entries(attributes).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [key]: { DataType: 'String', StringValue: value },
          }),
          {},
        )
      : undefined;
  }

  /**
   * Parse SQS message attributes into a simple key-value map
   * @param attributes - SQS message attributes
   * @returns Key-value map of attributes
   */
  private parseMessageAttributes(
    attributes?: Record<string, { StringValue?: string }>,
  ) {
    return attributes
      ? Object.entries(attributes).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [key]: value.StringValue || '',
          }),
          {},
        )
      : undefined;
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

    const queueUrl = await this.getQueueUrl(queueName);
    const messageId = message.id || randomUUID();

    // Warn for FIFO without required params
    const isFifo = queueName.endsWith('.fifo');
    if (isFifo && !message.groupId) {
      this.logger.warn(
        `FIFO queue ${queueName} publish without MessageGroupId; message may fail`,
      );
    }

    const command = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ id: messageId, body: message.body }),
      DelaySeconds: message.delaySeconds,
      MessageAttributes: this.createMessageAttributes(message.attributes),
      // FIFO queue specific
      ...(isFifo && {
        MessageGroupId: message.groupId,
        MessageDeduplicationId: message.deduplicationId,
      }),
    });

    try {
      const result = await this.client!.send(command);
      this.logger.debug(`Published message ${messageId} to ${queueName}`);

      return {
        messageId: result.MessageId || messageId,
        sequenceNumber: result.SequenceNumber,
        success: true,
      };
    } catch (error) {
      this.logger.error(`Failed to publish message to ${queueName}:`, error);

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
    this.ensureConnected();

    const queueUrl = await this.getQueueUrl(queueName);
    const idMap = new Map<string, string>(); // batch Id -> original messageId

    const isFifo = queueName.endsWith('.fifo');

    const entries = messages.map((msg, index) => {
      const originalId = msg.id || randomUUID();
      const batchId = String(index);
      idMap.set(batchId, originalId);

      return {
        Id: batchId,
        MessageBody: JSON.stringify({
          id: originalId,
          body: msg.body,
        }),
        DelaySeconds: msg.delaySeconds,
        MessageAttributes: this.createMessageAttributes(msg.attributes),
        ...(isFifo && {
          MessageGroupId: msg.groupId,
          MessageDeduplicationId: msg.deduplicationId,
        }),
      };
    });

    // SQS allows max 10 messages per batch
    const results: PublishResult[] = [];
    for (let i = 0; i < entries.length; i += 10) {
      const batch = entries.slice(i, i + 10);

      const command = new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch,
      });

      const result = await this.client!.send(command);

      result.Successful?.forEach((success) => {
        const originalId = idMap.get(success.Id!) || success.Id!;

        results.push({
          messageId: success.MessageId || originalId,
          sequenceNumber: success.SequenceNumber,
          success: true,
        });
      });

      result.Failed?.forEach((failure) => {
        const originalId = idMap.get(failure.Id!) || failure.Id!;

        this.logger.error(
          `Failed to publish message ${originalId} (${failure.Id}): ${failure.Message}`,
        );

        results.push({
          messageId: originalId,
          success: false,
        });
      });
    }

    this.logger.debug(
      `Published batch of ${messages.length} messages to ${queueName}`,
    );

    return results;
  }

  /**
   * Subscribe to a queue with a message handler
   * @param queueName - The name of the queue
   * @param handler - The message handler function
   * @returns Promise that resolves when subscription is set up
   */
  async subscribe<T>(
    queueName: string,
    handler: MessageHandler<T>,
  ): Promise<void> {
    this.ensureConnected();

    if (this.subscriptions.has(queueName)) {
      this.logger.warn(`Already subscribed to queue: ${queueName}`);
      return;
    }

    const pollInterval = (this.config.waitTimeSeconds || 20) * 1000;

    const poll = async () => {
      try {
        const messages = await this.receive<T>(queueName);
        for (const message of messages) {
          try {
            await handler(message);
            await this.acknowledge(queueName, message.receiptHandle);
          } catch (error) {
            this.logger.error(`Error processing message ${message.id}:`, error);
            // Message will become visible again after visibility timeout
          }
        }
      } catch (error) {
        this.logger.error(`Error polling queue ${queueName}:`, error);
      }
    };

    // Start polling
    const intervalId = setInterval(() => {
      void poll();
    }, pollInterval);

    this.subscriptions.set(queueName, intervalId);

    // Initial poll
    await poll();

    this.logger.log(`Subscribed to queue: ${queueName}`);
  }

  /**
   * Unsubscribe from a queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves when unsubscribed
   */
  unsubscribe(queueName: string): Promise<void> {
    const intervalId = this.subscriptions.get(queueName);

    if (intervalId) {
      clearInterval(intervalId);

      this.subscriptions.delete(queueName);

      this.logger.log(`Unsubscribed from queue: ${queueName}`);
    }

    return Promise.resolve();
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

    const queueUrl = await this.getQueueUrl(queueName);

    const maxNumMessages = maxMessages || this.config.maxMessages || 10;
    const visibilityTimeout = this.config.visibilityTimeout || 30;
    const waitTimeSeconds = this.config.waitTimeSeconds || 20;

    const command = new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: maxNumMessages,
      VisibilityTimeout: visibilityTimeout,
      WaitTimeSeconds: waitTimeSeconds,
      MessageAttributeNames: ['All'],
      // Only fetch message attributes, not system attributes to save bandwidth
      AttributeNames: undefined,
    });

    const result = await this.client!.send(command);

    return (result.Messages || []).map((msg) => {
      const parsed: { id?: string; body?: T } = JSON.parse(
        msg.Body || '{}',
      ) as { id?: string; body?: T };

      return {
        id: parsed.id || msg.MessageId,
        body: parsed.body as T,
        receiptHandle: msg.ReceiptHandle || '',
        receivedAt: new Date(),
        queueName,
        attributes: this.parseMessageAttributes(msg.MessageAttributes),
      };
    });
  }

  /**
   * Acknowledge (delete) a message from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandle - The receipt handle of the message to acknowledge
   * @returns Promise that resolves when the message is acknowledged
   */
  async acknowledge(queueName: string, receiptHandle: string): Promise<void> {
    this.ensureConnected();

    const queueUrl = await this.getQueueUrl(queueName);

    const command = new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    });

    await this.client!.send(command);
    this.logger.debug(`Acknowledged message from ${queueName}`);
  }

  /**
   * Acknowledge (delete) a batch of messages from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandles - Array of receipt handles of the messages to acknowledge
   * @returns Promise that resolves when the messages are acknowledged
   */
  async acknowledgeBatch(
    queueName: string,
    receiptHandles: string[],
  ): Promise<void> {
    this.ensureConnected();

    const queueUrl = await this.getQueueUrl(queueName);

    // SQS allows max 10 messages per batch
    let totalFailed = 0;
    for (let i = 0; i < receiptHandles.length; i += 10) {
      const batch = receiptHandles.slice(i, i + 10);

      const command = new DeleteMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((handle, index) => ({
          Id: String(index),
          ReceiptHandle: handle,
        })),
      });

      const result = await this.client!.send(command);

      if (result.Failed && result.Failed.length > 0) {
        this.logger.error(
          `Failed to acknowledge ${result.Failed.length} messages in batch from ${queueName}:`,
          result.Failed,
        );

        totalFailed += result.Failed.length;
      }
    }

    if (totalFailed === 0) {
      this.logger.debug(
        `Acknowledged ${receiptHandles.length} messages from ${queueName}`,
      );
    } else {
      this.logger.warn(
        `Acknowledged ${receiptHandles.length - totalFailed} out of ${receiptHandles.length} messages from ${queueName}`,
      );
    }
  }

  /**
   * Create a new queue with the specified name and options
   * @param queueName - The name of the queue
   * @param options - Optional configuration options for the queue
   * @returns The URL of the created queue
   */
  async createQueue(
    queueName: string,
    options?: Record<string, unknown>,
  ): Promise<string> {
    this.ensureConnected();

    const isFifo = queueName.endsWith('.fifo');
    const attributes: Record<string, string> = {};

    if (isFifo) {
      attributes['FifoQueue'] = 'true';
      attributes['ContentBasedDeduplication'] = 'true';
    }

    if (options?.visibilityTimeout) {
      const vt = Number(options.visibilityTimeout);

      if (isNaN(vt) || vt < 0) {
        throw new Error('visibilityTimeout must be a non-negative number');
      }

      attributes['VisibilityTimeout'] = String(vt);
    }

    if (options?.messageRetentionPeriod) {
      const mrp = Number(options.messageRetentionPeriod);

      if (isNaN(mrp) || mrp < 0) {
        throw new Error('messageRetentionPeriod must be a non-negative number');
      }

      attributes['MessageRetentionPeriod'] = String(mrp);
    }

    const command = new CreateQueueCommand({
      QueueName: queueName,
      Attributes: Object.keys(attributes).length > 0 ? attributes : undefined,
    });

    const result = await this.client!.send(command);
    const queueUrl = result.QueueUrl || '';

    this.queueUrlCache.set(queueName, queueUrl);

    this.logger.log(`Created queue: ${queueName} at ${queueUrl}`);

    return queueUrl;
  }

  /**
   * Delete a queue with the specified name
   * @param queueName - The name of the queue
   * @returns Promise that resolves when the queue is deleted
   */
  async deleteQueue(queueName: string): Promise<void> {
    this.ensureConnected();

    const queueUrl = await this.getQueueUrl(queueName);

    const command = new DeleteQueueCommand({
      QueueUrl: queueUrl,
    });

    await this.client!.send(command);
    this.queueUrlCache.delete(queueName);

    this.logger.log(`Deleted queue: ${queueName}`);
  }

  /**
   * Get the URL of the specified queue
   * @param queueName - The name of the queue
   * @returns The URL of the queue
   */
  async getQueueUrl(queueName: string): Promise<string> {
    // Check cache first
    if (this.queueUrlCache.has(queueName)) {
      return this.queueUrlCache.get(queueName)!;
    }

    // If config provides a queue URL, use it
    if (this.config.queueUrl && queueName === this.config.name) {
      this.queueUrlCache.set(queueName, this.config.queueUrl);

      return this.config.queueUrl;
    }

    this.ensureConnected();

    const command = new GetQueueUrlCommand({
      QueueName: queueName,
    });

    try {
      const result = await this.client!.send(command);

      const queueUrl = result.QueueUrl || '';

      this.queueUrlCache.set(queueName, queueUrl);

      return queueUrl;
    } catch (error) {
      // Queue might not exist, try to create it
      this.logger.warn(
        `Queue ${queueName} not found, attempting to create it:`,
        error,
      );

      return this.createQueue(queueName);
    }
  }

  /**
   * Perform a health check on the SQS provider
   * @returns Object indicating health status and details
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    details?: Record<string, unknown>;
  }> {
    try {
      this.ensureConnected();

      const command = new ListQueuesCommand({});
      const result = await this.client!.send(command);

      return {
        healthy: true,
        details: {
          provider: this.providerType,
          region: this.config.region,
          endpoint: this.config.endpoint,
          queueCount: result.QueueUrls?.length || 0,
        },
      };
    } catch (error) {
      return {
        healthy: false,
        details: {
          provider: this.providerType,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  /**
   * Ensure the SQS client is connected
   * @throws Error if the client is not connected
   */
  private ensureConnected(): void {
    if (!this.isConnected()) {
      throw new Error('SQS client is not connected');
    }
  }

  /**
   * Validate the SQS provider configuration
   * @param config - The queue provider configuration
   * @throws BadRequestException if the configuration is invalid
   */
  private ensureValidConfig(config: QueueProviderConfig): void {
    if (!config.region) {
      throw new BadRequestException('region is required for SQS configuration');
    }

    if (config.visibilityTimeout && config.visibilityTimeout < 0) {
      throw new BadRequestException('visibilityTimeout must be non-negative');
    }

    if (config.waitTimeSeconds && config.waitTimeSeconds < 0) {
      throw new BadRequestException('waitTimeSeconds must be non-negative');
    }

    if (config.maxMessages && config.maxMessages < 1) {
      throw new BadRequestException('maxMessages must be at least 1');
    }
  }
}
