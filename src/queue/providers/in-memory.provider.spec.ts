import { InMemoryQueueProvider } from './in-memory.provider';
import { QueueProviderConfig, QueueMessage } from '../interfaces';

describe('InMemoryQueueProvider', () => {
  let provider: InMemoryQueueProvider;
  const config: QueueProviderConfig = {
    name: 'test-provider',
    maxMessages: 10,
    visibilityTimeout: 30,
    waitTimeSeconds: 1,
  };

  beforeEach(async () => {
    provider = new InMemoryQueueProvider(config);
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
  });

  describe('connect/disconnect', () => {
    it('should connect successfully', () => {
      expect(provider.isConnected()).toBe(true);
    });

    it('should disconnect successfully', async () => {
      await provider.disconnect();
      expect(provider.isConnected()).toBe(false);
    });

    it('should have correct provider type', () => {
      expect(provider.providerType).toBe('in-memory');
    });
  });

  describe('publish', () => {
    it('should publish a message successfully', async () => {
      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should publish a message with custom ID', async () => {
      const message: QueueMessage<{ test: string }> = {
        id: 'custom-id',
        body: { test: 'data' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('custom-id');
    });

    it('should publish a message with attributes', async () => {
      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
        attributes: { correlationId: 'abc-123' },
      };

      const result = await provider.publish('test-queue', message);
      expect(result.success).toBe(true);
    });

    it('should throw error when not connected', async () => {
      await provider.disconnect();

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      await expect(
        async () => await provider.publish('test-queue', message),
      ).rejects.toThrow('In-memory provider is not connected');
    });
  });

  describe('publishBatch', () => {
    it('should publish multiple messages', async () => {
      const messages: QueueMessage<{ index: number }>[] = [
        { body: { index: 1 } },
        { body: { index: 2 } },
        { body: { index: 3 } },
      ];

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe('receive', () => {
    it('should receive published messages', async () => {
      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      await provider.publish('test-queue', message);
      const received = await provider.receive<{ test: string }>('test-queue');

      expect(received).toHaveLength(1);
      expect(received[0].body).toEqual({ test: 'data' });
      expect(received[0].receiptHandle).toBeDefined();
    });

    it('should receive multiple messages', async () => {
      for (let i = 0; i < 5; i++) {
        await provider.publish('test-queue', { body: { index: i } });
      }

      const received = await provider.receive('test-queue', 3);
      expect(received).toHaveLength(3);
    });

    it('should return empty array for empty queue', async () => {
      const received = await provider.receive('empty-queue');
      expect(received).toHaveLength(0);
    });

    it('should not return messages during visibility timeout', async () => {
      await provider.publish('test-queue', { body: { test: 'data' } });

      // First receive
      const first = await provider.receive('test-queue');
      expect(first).toHaveLength(1);

      // Immediate second receive should return empty (message is invisible)
      const second = await provider.receive('test-queue');
      expect(second).toHaveLength(0);
    });
  });

  describe('acknowledge', () => {
    it('should remove message after acknowledgment', async () => {
      await provider.publish('test-queue', { body: { test: 'data' } });

      const received = await provider.receive<{ test: string }>('test-queue');
      expect(received).toHaveLength(1);

      await provider.acknowledge('test-queue', received[0].receiptHandle);

      // Queue should be empty after acknowledgment
      expect(provider.getQueueSize('test-queue')).toBe(0);
    });
  });

  describe('acknowledgeBatch', () => {
    it('should remove multiple messages after batch acknowledgment', async () => {
      for (let i = 0; i < 3; i++) {
        await provider.publish('test-queue', { body: { index: i } });
      }

      const received = await provider.receive('test-queue', 3);
      const handles = received.map((m) => m.receiptHandle);

      await provider.acknowledgeBatch('test-queue', handles);

      expect(provider.getQueueSize('test-queue')).toBe(0);
    });
  });

  describe('createQueue/deleteQueue', () => {
    it('should create a queue', async () => {
      const queueUrl = await provider.createQueue('new-queue');
      expect(queueUrl).toBe('new-queue');
    });

    it('should delete a queue', async () => {
      await provider.createQueue('to-delete');
      await provider.publish('to-delete', { body: { test: 'data' } });

      await provider.deleteQueue('to-delete');

      const received = await provider.receive('to-delete');
      expect(received).toHaveLength(0);
    });
  });

  describe('getQueueUrl', () => {
    it('should return queue name as URL', async () => {
      const url = await provider.getQueueUrl('test-queue');
      expect(url).toBe('test-queue');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when connected', async () => {
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.details?.provider).toBe('in-memory');
    });

    it('should return unhealthy status when disconnected', async () => {
      await provider.disconnect();
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
    });
  });

  describe('helper methods', () => {
    it('should get queue size', async () => {
      await provider.publish('test-queue', { body: { test: 1 } });
      await provider.publish('test-queue', { body: { test: 2 } });

      expect(provider.getQueueSize('test-queue')).toBe(2);
    });

    it('should clear a queue', async () => {
      await provider.publish('test-queue', { body: { test: 1 } });
      await provider.publish('test-queue', { body: { test: 2 } });

      provider.clearQueue('test-queue');

      expect(provider.getQueueSize('test-queue')).toBe(0);
    });

    it('should clear all queues', async () => {
      await provider.publish('queue-1', { body: { test: 1 } });
      await provider.publish('queue-2', { body: { test: 2 } });

      provider.clearAllQueues();

      expect(provider.getQueueSize('queue-1')).toBe(0);
      expect(provider.getQueueSize('queue-2')).toBe(0);
    });
  });

  describe('subscribe', () => {
    it('should call handler when message is published', async () => {
      const receivedMessages: unknown[] = [];

      await provider.subscribe('test-queue', async (message) => {
        receivedMessages.push(message.body);

        await provider.acknowledge('test-queue', message.receiptHandle);
      });

      await provider.publish('test-queue', { body: { test: 'subscribed' } });

      // Wait for the subscription to process
      await new Promise((resolve) => setTimeout(resolve, 1500));

      expect(receivedMessages).toContainEqual({ test: 'subscribed' });

      await provider.unsubscribe('test-queue');
    });
  });
});
