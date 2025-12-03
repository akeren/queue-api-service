import {
  MessageHandler,
  QueueMessage,
  ReceivedMessage,
} from './queue-message.interface';

/**
 * Configuration options for a queue provider
 */
export interface QueueProviderConfig {
  /**
   * Unique name or identifier for this queue configuration
   */
  name: string;

  /**
   * The queue URL or name
   */
  queueUrl?: string;

  /**
   * Region for cloud providers (e.g., AWS SQS)
   */
  region?: string;

  /**
   * Endpoint URL (useful for local development with LocalStack)
   */
  endpoint?: string;

  /**
   * Connection URL (for RabbitMQ, Redis, Kafka, NATS, etc.)
   */
  connectionUrl?: string;

  /**
   * Maximum number of messages to receive in one poll
   */
  maxMessages?: number;

  /**
   * Visibility timeout in seconds
   */
  visibilityTimeout?: number;

  /**
   * Wait time in seconds for long polling
   */
  waitTimeSeconds?: number;

  /**
   * Additional provider-specific options
   */
  options?: Record<string, unknown>;
}

/**
 * Result of a publish operation
 */
export interface PublishResult {
  /**
   * The message ID assigned by the queue provider
   */
  messageId: string;

  /**
   * Sequence number (for FIFO queues)
   */
  sequenceNumber?: string;

  /**
   * Whether the publish was successful
   */
  success: boolean;
}

/**
 * Abstract interface that all queue providers to implement
 * This follows the Strategy pattern for swappable queue implementations
 */
export interface IQueueProvider {
  /**
   * The provider type identifier (e.g., 'sqs', 'rabbitmq', 'redis', 'kafka', 'nats')
   */
  readonly providerType: string;

  /**
   * Initialize the queue provider connection
   */
  connect(): Promise<void>;

  /**
   * Gracefully close the queue provider connection
   */
  disconnect(): Promise<void>;

  /**
   * Check if the provider is connected
   */
  isConnected(): boolean;

  /**
   * Publish a message to the specified queue
   */
  publish<T>(
    queueName: string,
    message: QueueMessage<T>,
  ): Promise<PublishResult>;

  /**
   * Publish multiple messages to the specified queue
   */
  publishBatch<T>(
    queueName: string,
    messages: QueueMessage<T>[],
  ): Promise<PublishResult[]>;

  /**
   * Subscribe to messages from the specified queue
   * The handler will be called for each received message
   */
  subscribe<T>(queueName: string, handler: MessageHandler<T>): Promise<void>;

  /**
   * Unsubscribe from the specified queue
   */
  unsubscribe(queueName: string): Promise<void>;

  /**
   * Receive messages from the queue (manual pull)
   */
  receive<T>(
    queueName: string,
    maxMessages?: number,
  ): Promise<ReceivedMessage<T>[]>;

  /**
   * Acknowledge/delete a message from the queue
   */
  acknowledge(queueName: string, receiptHandle: string): Promise<void>;

  /**
   * Acknowledge multiple messages from the queue
   */
  acknowledgeBatch(queueName: string, receiptHandles: string[]): Promise<void>;

  /**
   * Create a queue if it doesn't exist
   */
  createQueue(
    queueName: string,
    options?: Record<string, unknown>,
  ): Promise<string>;

  /**
   * Delete a queue
   */
  deleteQueue(queueName: string): Promise<void>;

  /**
   * Get the URL/identifier for a queue
   */
  getQueueUrl(queueName: string): Promise<string>;

  /**
   * Health check for the queue provider
   */
  healthCheck(): Promise<{
    healthy: boolean;
    details?: Record<string, unknown>;
  }>;
}

/**
 * Injection token for the queue provider
 */
export const QUEUE_PROVIDER = Symbol('QUEUE_PROVIDER');

/**
 * Injection token for queue module options
 */
export const QUEUE_MODULE_OPTIONS = Symbol('QUEUE_MODULE_OPTIONS');
