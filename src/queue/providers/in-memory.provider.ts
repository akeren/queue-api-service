import { BadRequestException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  IQueueProvider,
  QueueProviderConfig,
  PublishResult,
  QueueMessage,
  ReceivedMessage,
  MessageHandler,
} from '../interfaces';

interface StoredMessage {
  id: string;
  body: unknown;
  attributes?: Record<string, string>;
  visibleAt: number;
  receiptHandle: string;
}

/**
 * In-Memory Queue Provider Implementation
 * Useful for testing and development without external dependencies
 */
export class InMemoryQueueProvider implements IQueueProvider {
  readonly providerType = 'in-memory';
  private readonly logger = new Logger(InMemoryQueueProvider.name);
  private connected = false;
  private readonly queues = new Map<string, StoredMessage[]>();
  private readonly subscriptions = new Map<string, NodeJS.Timeout>();
  private readonly visibilityTimeout: number;

  constructor(private readonly config: QueueProviderConfig) {
    this.ensureIsvalidQueueConfig(this.config);

    this.visibilityTimeout = (config.visibilityTimeout || 30) * 1000;
  }

  /**
   * Connect the in-memory provider
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void> {
    this.connected = true;

    this.logger.log('In-memory queue provider connected');

    return Promise.resolve();
  }

  /**
   * Disconnect the in-memory provider
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void> {
    // Stop all subscriptions
    for (const [, intervalId] of this.subscriptions) {
      clearInterval(intervalId);
    }

    this.subscriptions.clear();
    this.queues.clear();
    this.connected = false;

    this.logger.log('In-memory queue provider disconnected');

    return Promise.resolve();
  }

  /**
   * Check if the in-memory provider is connected
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Publish a message to the specified queue
   * @param queueName - The name of the queue
   * @param message - The message to publish
   * @returns Promise that resolves with the publish result
   */
  publish<T>(
    queueName: string,
    message: QueueMessage<T>,
  ): Promise<PublishResult> {
    this.ensureConnected();

    this.ensureQueue(queueName);

    const messageId = message.id || randomUUID();

    const delayMs = (message.delaySeconds || 0) * 1000;

    const storedMessage: StoredMessage = {
      id: messageId,
      body: message.body,
      attributes: message.attributes,
      visibleAt: Date.now() + delayMs,
      receiptHandle: randomUUID(),
    };

    this.queues.get(queueName)!.push(storedMessage);

    this.logger.log(`Published message ${messageId} to ${queueName}`);

    return Promise.resolve({
      messageId,
      success: true,
    });
  }

  /**
   * Publish multiple messages to the specified queue
   * @param queueName - The name of the queue
   * @param messages - The messages to publish
   * @returns Promise that resolves with an array of publish results
   */
  async publishBatch<T>(
    queueName: string,
    messages: QueueMessage<T>[],
  ): Promise<PublishResult[]> {
    const results: PublishResult[] = [];

    for (const message of messages) {
      const result = await this.publish(queueName, message);
      results.push(result);
    }

    this.logger.log(
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
  subscribe<T>(queueName: string, handler: MessageHandler<T>): Promise<void> {
    this.ensureConnected();

    this.ensureQueue(queueName);

    if (this.subscriptions.has(queueName)) {
      return Promise.resolve();
    }

    const pollInterval = (this.config.waitTimeSeconds || 1) * 1000;
    const maxMessages = this.config.maxMessages || 10;

    const poll = async (): Promise<void> => {
      if (!this.connected) return;

      const messages = await this.receive<T>(queueName, maxMessages);

      for (const message of messages) {
        try {
          await handler(message);

          this.logger.log(`Processed message ${message.id} from ${queueName}`);

          await this.acknowledge(queueName, message.receiptHandle);
        } catch (error) {
          this.logger.error(`Error processing message:`, error);
          // Note: Failed messages will become visible again after visibilityTimeout
        }
      }
    };

    const intervalId = setInterval(() => void poll(), pollInterval);

    this.subscriptions.set(queueName, intervalId);

    this.logger.log(`Subscribed to queue: ${queueName}`);

    // Initial immediate poll
    void poll();

    return Promise.resolve();
  }

  /**
   * Unsubscribe from messages from the specified queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves when unsubscription is complete
   */
  unsubscribe(queueName: string): Promise<void> {
    const intervalId = this.subscriptions.get(queueName);

    if (intervalId) {
      clearInterval(intervalId);

      this.subscriptions.delete(queueName);

      this.logger.log(`Unsubscribed from queue: ${queueName}`);
    } else {
      this.logger.log(`No active subscription for queue: ${queueName}`);
    }

    return Promise.resolve();
  }

  /**
   * Receive messages from the specified queue
   * @param queueName - The name of the queue
   * @param maxMessages - Maximum number of messages to receive
   * @returns Promise that resolves with an array of received messages
   */
  receive<T>(
    queueName: string,
    maxMessages?: number,
  ): Promise<ReceivedMessage<T>[]> {
    this.ensureConnected();

    this.ensureQueue(queueName);

    const now = Date.now();

    // Reduced verbosity: Log only on non-empty receives for production-like testing
    const queue = this.queues.get(queueName)!;
    const limit = maxMessages || this.config.maxMessages || 10;

    const visibleMessages = queue.filter((msg) => msg.visibleAt <= now);
    const messagesToReturn = visibleMessages.slice(0, limit);

    // Make messages invisible for visibility timeout
    // Regenerate receiptHandle for new "lease" to prevent ack of previous receives
    for (const msg of messagesToReturn) {
      msg.visibleAt = now + this.visibilityTimeout;
      msg.receiptHandle = randomUUID(); // New receipt handle for this receive
    }

    if (messagesToReturn.length > 0) {
      this.logger.log(
        `Received ${messagesToReturn.length} messages from ${queueName}`,
      );
    }

    return Promise.resolve(
      messagesToReturn.map((msg) => ({
        id: msg.id,
        body: msg.body as T,
        receiptHandle: msg.receiptHandle,
        receivedAt: new Date(),
        queueName,
        attributes: msg.attributes,
      })),
    );
  }

  /**
   * Acknowledge a message from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandle - The receipt handle of the message to acknowledge
   * @returns Promise that resolves when the message is acknowledged
   */
  acknowledge(queueName: string, receiptHandle: string): Promise<void> {
    this.ensureConnected();

    this.ensureQueue(queueName);

    const queue = this.queues.get(queueName)!;

    const index = queue.findIndex((msg) => msg.receiptHandle === receiptHandle);

    if (index !== -1) {
      queue.splice(index, 1);

      this.logger.log(`Acknowledged message from ${queueName}`);
    }

    return Promise.resolve();
  }

  /**
   * Acknowledge multiple messages from the specified queue
   * @param queueName - The name of the queue
   * @param receiptHandles - The receipt handles of the messages to acknowledge
   * @returns Promise that resolves when the messages are acknowledged
   */
  acknowledgeBatch(queueName: string, receiptHandles: string[]): Promise<void> {
    this.ensureConnected();

    this.ensureQueue(queueName);

    const queue = this.queues.get(queueName)!;

    // Collect indices to remove for efficient batch deletion
    const indicesToRemove = receiptHandles
      .map((handle) => queue.findIndex((msg) => msg.receiptHandle === handle))
      .filter((i) => i !== -1)
      .sort((a, b) => b - a); // Sort descending to splice from end

    for (const index of indicesToRemove) {
      queue.splice(index, 1);
    }

    this.logger.log(
      `Acknowledged batch of ${indicesToRemove.length} messages from ${queueName}`,
    );

    return Promise.resolve();
  }

  /**
   * Create a queue if it doesn't exist
   * @param queueName - The name of the queue
   * @returns Promise that resolves with the queue URL (name)
   */
  createQueue(queueName: string): Promise<string> {
    this.logger.log(`Creating queue: ${queueName}`);

    this.ensureQueue(queueName);

    this.logger.log(`Created queue: ${queueName}`);

    return Promise.resolve(queueName);
  }

  /**
   * Delete a queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves when the queue is deleted
   */
  deleteQueue(queueName: string): Promise<void> {
    this.logger.log(`Deleting queue: ${queueName}`);
    this.queues.delete(queueName);

    this.logger.log(`Deleted queue: ${queueName}`);

    return Promise.resolve();
  }

  /**
   * Get the URL of a queue
   * @param queueName - The name of the queue
   * @returns Promise that resolves with the queue URL (name)
   */
  getQueueUrl(queueName: string): Promise<string> {
    return Promise.resolve(queueName);
  }

  /**
   * Perform a health check on the in-memory provider
   * @returns Object indicating health status and details
   */
  healthCheck(): Promise<{
    healthy: boolean;
    details?: Record<string, unknown>;
  }> {
    this.logger.log('Performing health check for in-memory provider');

    return Promise.resolve({
      healthy: this.connected,
      details: {
        provider: this.providerType,
        queueCount: this.queues.size,
        queues: Array.from(this.queues.keys()),
      },
    });
  }

  /**
   * Get the number of messages in the specified queue
   * @param queueName - The name of the queue
   * @returns The number of messages in the queue
   */
  getQueueSize(queueName: string): number {
    return this.queues.get(queueName)?.length || 0;
  }

  /**
   * Clear all messages from the specified queue
   * @param queueName - The name of the queue
   */
  clearQueue(queueName: string): void {
    if (this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
  }

  /**
   * Clear all messages from all queues
   */
  clearAllQueues(): void {
    for (const queueName of this.queues.keys()) {
      this.queues.set(queueName, []);
    }
  }

  /**
   * Ensure the provider is connected
   * @throws BadRequestException if not connected
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new BadRequestException('In-memory provider is not connected');
    }
  }

  /**
   * Ensure the queue exists
   * @param queueName - The name of the queue
   */
  private ensureQueue(queueName: string): void {
    if (!this.queues.has(queueName)) {
      this.queues.set(queueName, []);
    }
  }

  private ensureIsvalidQueueConfig(config: QueueProviderConfig): void {
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
