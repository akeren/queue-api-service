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
} from '@aws-sdk/client-sqs';
import { SqsQueueProvider } from './sqs.provider';
import { QueueProviderConfig, QueueMessage } from '../interfaces';

// Mock the AWS SDK
jest.mock('@aws-sdk/client-sqs', () => {
  const mockSend = jest.fn();
  const mockDestroy = jest.fn();

  return {
    SQSClient: jest.fn().mockImplementation(() => ({
      send: mockSend,
      destroy: mockDestroy,
    })),
    ListQueuesCommand: jest.fn(),
    SendMessageCommand: jest.fn(),
    SendMessageBatchCommand: jest.fn(),
    ReceiveMessageCommand: jest.fn(),
    DeleteMessageCommand: jest.fn(),
    DeleteMessageBatchCommand: jest.fn(),
    CreateQueueCommand: jest.fn(),
    DeleteQueueCommand: jest.fn(),
    GetQueueUrlCommand: jest.fn(),
  };
});

describe('SqsQueueProvider', () => {
  let provider: SqsQueueProvider;
  let mockSend: jest.Mock;
  let mockDestroy: jest.Mock;

  const config: QueueProviderConfig = {
    name: 'test-sqs-provider',
    region: 'us-east-1',
    endpoint: 'http://localhost:4566',
    maxMessages: 10,
    visibilityTimeout: 30,
    waitTimeSeconds: 20,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Get mock functions from the mocked SQSClient
    const MockedSQSClient = SQSClient as jest.MockedClass<typeof SQSClient>;
    mockSend = jest.fn();
    mockDestroy = jest.fn();

    MockedSQSClient.mockImplementation(
      () =>
        ({
          send: mockSend,
          destroy: mockDestroy,
        }) as unknown as SQSClient,
    );

    provider = new SqsQueueProvider(config);
  });

  afterEach(async () => {
    if (provider.isConnected()) {
      await provider.disconnect();
    }
  });

  describe('connect', () => {
    it('should connect successfully', async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });

      await provider.connect();

      expect(provider.isConnected()).toBe(true);
      expect(SQSClient).toHaveBeenCalledWith({
        region: 'us-east-1',
        endpoint: 'http://localhost:4566',
        credentials: {
          accessKeyId: expect.any(String) as string,
          secretAccessKey: expect.any(String) as string,
        },
      });
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should throw error if connection fails', async () => {
      mockSend.mockRejectedValueOnce(new Error('Connection failed'));

      await expect(provider.connect()).rejects.toThrow('Connection failed');
      expect(provider.isConnected()).toBe(false);
    });

    it('should have correct provider type', () => {
      expect(provider.providerType).toBe('sqs');
    });
  });

  describe('disconnect', () => {
    it('should disconnect successfully', async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();

      await provider.disconnect();

      expect(provider.isConnected()).toBe(false);
    });

    it('should stop all subscriptions on disconnect', async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();

      // Mock for getQueueUrl and receive
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({ Messages: [] });

      await provider.subscribe('test-queue', async () => {});

      await provider.disconnect();

      expect(provider.isConnected()).toBe(false);
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should publish a message successfully', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-123',
        SequenceNumber: '1',
      });

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('msg-123');
      expect(result.sequenceNumber).toBe('1');
      expect(SendMessageCommand).toHaveBeenCalled();
    });

    it('should publish a message with custom ID', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        MessageId: 'custom-id',
      });

      const message: QueueMessage<{ test: string }> = {
        id: 'custom-id',
        body: { test: 'data' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('custom-id');
    });

    it('should publish a message with delay', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-delayed',
      });

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'delayed' },
        delaySeconds: 60,
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
    });

    it('should publish a message with attributes', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-attrs',
      });

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
        attributes: { priority: 'high', source: 'api' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
    });

    it('should publish to FIFO queue with groupId and deduplicationId', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue.fifo',
      });
      mockSend.mockResolvedValueOnce({
        MessageId: 'msg-fifo',
        SequenceNumber: '12345',
      });

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'fifo-data' },
        groupId: 'group-1',
        deduplicationId: 'dedup-1',
      };

      const result = await provider.publish('test-queue.fifo', message);

      expect(result.success).toBe(true);
      expect(result.sequenceNumber).toBe('12345');
    });

    it('should throw error when not connected', async () => {
      await provider.disconnect();

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      await expect(provider.publish('test-queue', message)).rejects.toThrow(
        'SQS client is not connected',
      );
    });

    it('should throw error on publish failure', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockRejectedValueOnce(new Error('Publish failed'));

      const message: QueueMessage<{ test: string }> = {
        body: { test: 'data' },
      };

      await expect(provider.publish('test-queue', message)).rejects.toThrow(
        'Publish failed',
      );
    });
  });

  describe('publishBatch', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should publish multiple messages', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        Successful: [
          { Id: '0', MessageId: 'msg-1' },
          { Id: '1', MessageId: 'msg-2' },
          { Id: '2', MessageId: 'msg-3' },
        ],
        Failed: [],
      });

      const messages: QueueMessage<{ index: number }>[] = [
        { body: { index: 1 } },
        { body: { index: 2 } },
        { body: { index: 3 } },
      ];

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(SendMessageBatchCommand).toHaveBeenCalled();
    });

    it('should handle partial failures', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        Successful: [{ Id: '0', MessageId: 'msg-1' }],
        Failed: [{ Id: '1', Message: 'Invalid message' }],
      });

      const messages: QueueMessage<{ index: number }>[] = [
        { body: { index: 1 } },
        { body: { index: 2 } },
      ];

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
    });

    it('should batch messages in groups of 10', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });

      // First batch of 10
      mockSend.mockResolvedValueOnce({
        Successful: Array.from({ length: 10 }, (_, i) => ({
          Id: String(i),
          MessageId: `msg-${i}`,
        })),
        Failed: [],
      });

      // Second batch of 2
      mockSend.mockResolvedValueOnce({
        Successful: [
          { Id: '0', MessageId: 'msg-10' },
          { Id: '1', MessageId: 'msg-11' },
        ],
        Failed: [],
      });

      const messages: QueueMessage<{ index: number }>[] = Array.from(
        { length: 12 },
        (_, i) => ({ body: { index: i } }),
      );

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(12);
      expect(SendMessageBatchCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should receive messages from queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-1',
            Body: JSON.stringify({ id: 'msg-1', body: { test: 'data1' } }),
            ReceiptHandle: 'receipt-1',
          },
          {
            MessageId: 'msg-2',
            Body: JSON.stringify({ id: 'msg-2', body: { test: 'data2' } }),
            ReceiptHandle: 'receipt-2',
          },
        ],
      });

      const messages = await provider.receive<{ test: string }>('test-queue');

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[0].body).toEqual({ test: 'data1' });
      expect(messages[0].receiptHandle).toBe('receipt-1');
      expect(messages[1].id).toBe('msg-2');
      expect(ReceiveMessageCommand).toHaveBeenCalled();
    });

    it('should receive messages with attributes', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-1',
            Body: JSON.stringify({ id: 'msg-1', body: { test: 'data' } }),
            ReceiptHandle: 'receipt-1',
            MessageAttributes: {
              priority: { StringValue: 'high', DataType: 'String' },
            },
          },
        ],
      });

      const messages = await provider.receive<{ test: string }>('test-queue');

      expect(messages).toHaveLength(1);
      expect(messages[0].attributes).toEqual({ priority: 'high' });
    });

    it('should return empty array for empty queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/empty-queue',
      });
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const messages = await provider.receive('empty-queue');

      expect(messages).toHaveLength(0);
    });

    it('should respect maxMessages parameter', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({
        Messages: [
          {
            MessageId: 'msg-1',
            Body: JSON.stringify({ id: 'msg-1', body: {} }),
            ReceiptHandle: 'receipt-1',
          },
        ],
      });

      await provider.receive('test-queue', 5);

      expect(ReceiveMessageCommand).toHaveBeenCalled();
    });
  });

  describe('acknowledge', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should acknowledge a message', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({});

      await provider.acknowledge('test-queue', 'receipt-handle-123');

      expect(DeleteMessageCommand).toHaveBeenCalled();
    });
  });

  describe('acknowledgeBatch', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should acknowledge multiple messages', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({});

      await provider.acknowledgeBatch('test-queue', [
        'receipt-1',
        'receipt-2',
        'receipt-3',
      ]);

      expect(DeleteMessageBatchCommand).toHaveBeenCalled();
    });

    it('should batch acknowledgments in groups of 10', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      const handles = Array.from({ length: 12 }, (_, i) => `receipt-${i}`);

      await provider.acknowledgeBatch('test-queue', handles);

      expect(DeleteMessageBatchCommand).toHaveBeenCalledTimes(2);
    });
  });

  describe('createQueue', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should create a standard queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/new-queue',
      });

      const queueUrl = await provider.createQueue('new-queue');

      expect(queueUrl).toBe('http://localhost:4566/queue/new-queue');
      expect(CreateQueueCommand).toHaveBeenCalled();
    });

    it('should create a FIFO queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/new-queue.fifo',
      });

      const queueUrl = await provider.createQueue('new-queue.fifo');

      expect(queueUrl).toBe('http://localhost:4566/queue/new-queue.fifo');
    });

    it('should create a queue with custom options', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/custom-queue',
      });

      const queueUrl = await provider.createQueue('custom-queue', {
        visibilityTimeout: 60,
        messageRetentionPeriod: 86400,
      });

      expect(queueUrl).toBe('http://localhost:4566/queue/custom-queue');
    });
  });

  describe('deleteQueue', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should delete a queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/to-delete',
      });
      mockSend.mockResolvedValueOnce({});

      await provider.deleteQueue('to-delete');

      expect(DeleteQueueCommand).toHaveBeenCalled();
    });
  });

  describe('getQueueUrl', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should get queue URL', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/test-queue',
      });

      const url = await provider.getQueueUrl('test-queue');

      expect(url).toBe('http://localhost:4566/queue/test-queue');
      expect(GetQueueUrlCommand).toHaveBeenCalled();
    });

    it('should cache queue URL', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/cached-queue',
      });

      // First call
      await provider.getQueueUrl('cached-queue');
      // Second call should use cache
      const url = await provider.getQueueUrl('cached-queue');

      expect(url).toBe('http://localhost:4566/queue/cached-queue');
      expect(GetQueueUrlCommand).toHaveBeenCalledTimes(1);
    });

    it('should create queue if not found', async () => {
      mockSend.mockRejectedValueOnce(new Error('Queue does not exist'));
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/auto-created',
      });

      const url = await provider.getQueueUrl('auto-created');

      expect(url).toBe('http://localhost:4566/queue/auto-created');
      expect(CreateQueueCommand).toHaveBeenCalled();
    });
  });

  describe('subscribe/unsubscribe', () => {
    beforeEach(async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();
    });

    it('should subscribe to a queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/sub-queue',
      });
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const handler = jest.fn();
      await provider.subscribe('sub-queue', handler);

      // Cleanup
      await provider.unsubscribe('sub-queue');
    });

    it('should not subscribe twice to same queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/sub-queue',
      });
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const handler = jest.fn();
      await provider.subscribe('sub-queue', handler);
      await provider.subscribe('sub-queue', handler); // Should be ignored

      await provider.unsubscribe('sub-queue');
    });

    it('should unsubscribe from a queue', async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: 'http://localhost:4566/queue/sub-queue',
      });
      mockSend.mockResolvedValueOnce({ Messages: [] });

      const handler = jest.fn();
      await provider.subscribe('sub-queue', handler);

      await provider.unsubscribe('sub-queue');

      // Unsubscribing again should be safe
      await provider.unsubscribe('sub-queue');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when connected', async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();

      mockSend.mockResolvedValueOnce({
        QueueUrls: ['queue1', 'queue2', 'queue3'],
      });

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(true);
      expect(health.details?.provider).toBe('sqs');
      expect(health.details?.queueCount).toBe(3);
    });

    it('should return unhealthy status when disconnected', async () => {
      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.details?.error).toBeDefined();
    });

    it('should return unhealthy status on error', async () => {
      mockSend.mockResolvedValueOnce({ QueueUrls: [] });
      await provider.connect();

      mockSend.mockRejectedValueOnce(new Error('Health check failed'));

      const health = await provider.healthCheck();

      expect(health.healthy).toBe(false);
      expect(health.details?.error).toBe('Health check failed');
    });
  });
});
