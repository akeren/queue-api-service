/**
 * Represents a message to be sent to a queue
 */
export interface QueueMessage<T = unknown> {
  /**
   * Unique identifier for the message
   */
  id?: string;

  /**
   * The actual payload of the message
   */
  body: T;

  /**
   * Optional message attributes/headers
   */
  attributes?: Record<string, string>;

  /**
   * Optional delay in seconds before the message becomes visible
   */
  delaySeconds?: number;

  /**
   * Optional message group ID (for FIFO queues)
   */
  groupId?: string;

  /**
   * Optional deduplication ID (for FIFO queues)
   */
  deduplicationId?: string;
}

/**
 * Represents a message received from a queue
 */
export interface ReceivedMessage<T = unknown> extends QueueMessage<T> {
  /**
   * The receipt handle used for acknowledging/deleting the message
   */
  receiptHandle: string;

  /**
   * Timestamp when the message was received
   */
  receivedAt: Date;

  /**
   * The queue name from which the message was received
   */
  queueName: string;
}

/**
 * Handler function type for processing received messages
 */
export type MessageHandler<T = unknown> = (
  message: ReceivedMessage<T>,
) => Promise<void>;
