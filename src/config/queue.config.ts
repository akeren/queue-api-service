import { Logger } from '@nestjs/common';
import { registerAs } from '@nestjs/config';
import {
  QueueModuleOptions,
  QueueProviderOptions,
  QueueProviderType,
} from '../queue/interfaces';

/**
 * Generate common queue options from environment variables
 * @param isInMemory - Whether the provider is in-memory
 * @returns Common queue options
 */
const getCommonQueueOptions = (
  isInMemory = false,
): Pick<
  QueueProviderOptions,
  'maxMessages' | 'visibilityTimeout' | 'waitTimeSeconds'
> => ({
  maxMessages: safeParseInt(process.env.QUEUE_MAX_MESSAGES, 10),
  visibilityTimeout: safeParseInt(
    process.env.QUEUE_VISIBILITY_TIMEOUT_IN_SECONDS,
    30,
  ),
  waitTimeSeconds: safeParseInt(
    process.env.QUEUE_WAIT_TIME_IN_SECONDS,
    isInMemory ? 1 : 20,
  ),
});

/**
 * Configuration for the Queue module
 * Supports multiple queue providers based on environment variables
 * - QUEUE_PROVIDER: single provider (sqs, rabbitmq, in-memory)
 * - QUEUE_PROVIDERS: comma-separated list of providers for multiple
 * e.g., "sqs,rabbitmq,in-memory"
 * If no providers specified, defaults to in-memory
 * with sensible defaults for local development
 * Each provider can be further configured via env vars:
 * - AWS_REGION, AWS_SQS_ENDPOINT for SQS
 * - RABBITMQ_URL for RabbitMQ
 * Additional common options:
 * - QUEUE_MAX_MESSAGES
 * - QUEUE_VISIBILITY_TIMEOUT_IN_SECONDS
 * - QUEUE_WAIT_TIME_IN_SECONDS
 * - QUEUE_HEALTH_CHECKS (true/false)
 * @returns QueueModuleOptions
 */
export default registerAs('queue', (): QueueModuleOptions => {
  const queueProviderTypes = parseQueueProviderTypes();

  const providers: QueueProviderOptions[] = [];

  for (const [index, type] of queueProviderTypes.entries()) {
    const isDefault = index === 0;

    const commonQueueOptions = getCommonQueueOptions(type === 'in-memory');

    switch (type) {
      case 'sqs':
        providers.push({
          name: 'sqs',
          type: 'sqs',
          region: process.env.AWS_REGION || 'eu-west-1',
          endpoint: process.env.AWS_SQS_ENDPOINT,
          ...commonQueueOptions,
          isDefault,
        });
        break;

      case 'rabbitmq':
        providers.push({
          name: 'rabbitmq',
          type: 'rabbitmq',
          connectionUrl:
            process.env.RABBITMQ_URL ||
            `amqp://guest:rabbitmq@localhost:${process.env.RABBITMQ_PORT || 5672}`,
          ...commonQueueOptions,
          isDefault,
        });
        break;

      case 'in-memory':
        providers.push({
          name: 'in-memory',
          type: 'in-memory',
          ...commonQueueOptions,
          isDefault,
        });
        break;
    }
  }

  /**
   * If no providers configured, default to in-memory
   * for local development and testing purposes
   */
  if (providers.length === 0) {
    providers.push({
      name: 'in-memory',
      type: 'in-memory',
      ...getCommonQueueOptions(true),
      isDefault: true,
    });
  }

  return {
    providers,
    enableHealthChecks: process.env.QUEUE_HEALTH_CHECKS !== 'false',
    global: true,
  };
});

/**
 * Parse queue provider types from environment variables
 * Supports single or multiple providers
 * @returns Array of QueueProviderType
 */
function parseQueueProviderTypes(): QueueProviderType[] {
  const queueProviders = process.env.QUEUE_PROVIDERS;

  const multipleQueueProviders = checkForMultipleQueueProviders(queueProviders);

  if (multipleQueueProviders) {
    Logger.log('Multiple queue providers detected; ignoring QUEUE_PROVIDER.');

    return multipleQueueProviders;
  }

  const queueProvider = (
    process.env.QUEUE_PROVIDER || ''
  ).toLowerCase() as QueueProviderType;

  const singleQueueProvider = checkForSingleQueueProvider(queueProvider);

  if (singleQueueProvider) {
    Logger.log(`Single queue provider detected: ${queueProvider}`);

    return singleQueueProvider;
  }

  Logger.warn('No valid queue providers specified; defaulting to in-memory.');

  return [];
}

/**
 * Safely parse an integer from a string, with a default fallback
 * @param value - The string value to parse
 * @param defaultValue - The default value if parsing fails
 * @returns Parsed integer or default value
 */
function safeParseInt(value: string | undefined, defaultValue: number): number {
  const parsed = parseInt(value || String(defaultValue), 10);

  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Check if a single queue provider is valid
 * @param queueProvider - The queue provider type as a string
 * @returns Array with single QueueProviderType or false if invalid
 */
function checkForSingleQueueProvider(
  queueProvider: QueueProviderType,
): QueueProviderType[] | false {
  if (
    queueProvider &&
    ['sqs', 'rabbitmq', 'in-memory'].includes(queueProvider)
  ) {
    return [queueProvider];
  }

  return false;
}

/**
 * Check for multiple queue providers from a comma-separated list
 * @param queueProviders - Comma-separated string of queue providers
 * @returns Array of QueueProviderType or false if none valid
 */
function checkForMultipleQueueProviders(
  queueProviders: string | undefined,
): QueueProviderType[] | false {
  if (!queueProviders?.trim()) {
    return false;
  }

  /**
   * Parse and validate the queue providers
   * @returns Array of valid QueueProviderType or false if none valid
   */
  const validQueueProviders = queueProviders
    .split(',')
    .map((p: string) => p.trim().toLowerCase())
    .filter((p: string): p is QueueProviderType =>
      ['sqs', 'rabbitmq', 'in-memory'].includes(p),
    )
    .filter((p, index, self) => self.indexOf(p) === index); // Remove duplicates

  if (validQueueProviders.length === 0) {
    Logger.warn(
      `Invalid providers in QUEUE_PROVIDERS="${queueProviders}"; ignoring.`,
    );

    return false;
  }

  return validQueueProviders;
}
