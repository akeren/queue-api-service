/* eslint-disable @typescript-eslint/unbound-method */
import { RabbitMqQueueProvider } from './rabbitmq.provider';
import * as amqplib from 'amqplib';
import { QueueMessage } from '../interfaces';

// Mock amqplib
jest.mock('amqplib');

describe('RabbitMqQueueProvider', () => {
  let provider: RabbitMqQueueProvider;
  let mockConnection: jest.Mocked<amqplib.ChannelModel>;
  let mockChannel: jest.Mocked<amqplib.Channel>;

  const defaultConfig = {
    name: 'test-rabbitmq',
    connectionUrl: 'amqp://guest:guest@localhost:5672/',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock channel
    mockChannel = {
      prefetch: jest.fn().mockResolvedValue(undefined),
      assertQueue: jest.fn().mockResolvedValue({
        queue: 'test-queue',
        messageCount: 0,
        consumerCount: 0,
      }),
      sendToQueue: jest.fn().mockReturnValue(true),
      consume: jest
        .fn()
        .mockResolvedValue({ consumerTag: 'test-consumer-tag' }),
      cancel: jest.fn().mockResolvedValue(undefined),
      get: jest.fn().mockResolvedValue(false),
      ack: jest.fn(),
      nack: jest.fn(),
      deleteQueue: jest.fn().mockResolvedValue({ messageCount: 0 }),
      checkQueue: jest.fn().mockResolvedValue({
        queue: 'test-queue',
        messageCount: 5,
        consumerCount: 1,
      }),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<amqplib.Channel>;

    // Create mock connection
    mockConnection = {
      createChannel: jest.fn().mockResolvedValue(mockChannel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    } as unknown as jest.Mocked<amqplib.ChannelModel>;

    // Mock amqplib.connect
    (amqplib.connect as jest.Mock).mockResolvedValue(mockConnection);

    // Create provider instance
    provider = new RabbitMqQueueProvider(defaultConfig);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('connect', () => {
    it('should connect to RabbitMQ successfully', async () => {
      await provider.connect();

      expect(amqplib.connect).toHaveBeenCalledWith(defaultConfig.connectionUrl);
      expect(mockConnection.createChannel.mock.calls.length).toBeGreaterThan(0);
      expect(mockChannel.prefetch.mock.calls.length).toBeGreaterThan(0);
    });

    it('should create new connection on each connect call', async () => {
      await provider.connect();
      await provider.connect();

      // The provider creates a new connection on each call
      expect(amqplib.connect).toHaveBeenCalledTimes(2);
    });

    it('should throw error when connection fails', async () => {
      const error = new Error('Connection refused');
      (amqplib.connect as jest.Mock).mockRejectedValue(error);

      await expect(provider.connect()).rejects.toThrow('Connection refused');
    });

    it('should throw error when channel creation fails', async () => {
      const error = new Error('Channel creation failed');
      mockConnection.createChannel.mockRejectedValue(error);

      await expect(provider.connect()).rejects.toThrow(
        'Channel creation failed',
      );
    });

    it('should register connection error and close handlers', async () => {
      await provider.connect();

      expect(mockConnection.on.mock.calls).toContainEqual([
        'error',
        expect.any(Function),
      ]);
      expect(mockConnection.on.mock.calls).toContainEqual([
        'close',
        expect.any(Function),
      ]);
    });
  });

  describe('disconnect', () => {
    it('should disconnect from RabbitMQ successfully', async () => {
      await provider.connect();
      await provider.disconnect();

      expect(mockChannel.close.mock.calls.length).toBeGreaterThan(0);
      expect(mockConnection.close.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle disconnect when not connected', async () => {
      // Should not throw when disconnecting without connection
      await expect(provider.disconnect()).resolves.not.toThrow();
    });

    it('should cancel consumers before disconnecting', async () => {
      await provider.connect();

      // Subscribe to create a consumer
      await provider.subscribe('test-queue', jest.fn());

      await provider.disconnect();

      expect(mockChannel.cancel.mock.calls).toContainEqual([
        expect.stringContaining('test-consumer-tag'),
      ]);
    });
  });

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      expect(provider.isConnected()).toBe(false);
    });

    it('should return true when connected', async () => {
      await provider.connect();

      expect(provider.isConnected()).toBe(true);
    });
  });

  describe('publish', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should publish a message successfully', async () => {
      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result).toHaveProperty('messageId');
      expect(result).toHaveProperty('success', true);
      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Buffer),
        expect.objectContaining({
          persistent: true,
          messageId: expect.any(String) as string,
        }),
      );
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
      };

      await expect(provider.publish('test-queue', message)).rejects.toThrow(
        'RabbitMQ client is not connected',
      );
    });

    it('should return success false when sendToQueue fails', async () => {
      mockChannel.sendToQueue.mockReturnValue(false);

      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
      };
      const result = await provider.publish('test-queue', message);

      expect(result).toHaveProperty('success', false);
    });

    it('should serialize message body as JSON', async () => {
      const messageBody = { key: 'value', nested: { data: 123 } };
      const message: QueueMessage<typeof messageBody> = { body: messageBody };

      await provider.publish('test-queue', message);

      const call = mockChannel.sendToQueue.mock.calls[0];
      const buffer = call[1];
      const parsed = JSON.parse(buffer.toString()) as {
        body: typeof messageBody;
      };

      expect(parsed).toHaveProperty('body', messageBody);
    });

    it('should use provided message id', async () => {
      const message: QueueMessage<{ data: string }> = {
        id: 'custom-id-123',
        body: { data: 'test' },
      };

      const result = await provider.publish('test-queue', message);

      expect(result.messageId).toBe('custom-id-123');
    });

    it('should include custom attributes as headers', async () => {
      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
        attributes: { 'x-custom-header': 'custom-value' },
      };

      await provider.publish('test-queue', message);

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-custom-header': 'custom-value',
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should include delay as x-delay header', async () => {
      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
        delaySeconds: 60,
      };

      await provider.publish('test-queue', message);

      expect(mockChannel.sendToQueue).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Buffer),
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-delay': 60000,
          }) as Record<string, unknown>,
        }),
      );
    });

    it('should assert queue before publishing', async () => {
      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
      };

      await provider.publish('new-queue', message);

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'new-queue',
        expect.any(Object),
      );
    });
  });

  describe('publishBatch', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should publish multiple messages successfully', async () => {
      const messages: QueueMessage<{ data: string }>[] = [
        { body: { data: 'msg1' } },
        { body: { data: 'msg2' } },
        { body: { data: 'msg3' } },
      ];

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('success', true);
      expect(results[1]).toHaveProperty('success', true);
      expect(results[2]).toHaveProperty('success', true);
      expect(mockChannel.sendToQueue).toHaveBeenCalledTimes(3);
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      const messages: QueueMessage<{ data: string }>[] = [
        { body: { data: 'test' } },
      ];

      await expect(
        provider.publishBatch('test-queue', messages),
      ).rejects.toThrow('RabbitMQ client is not connected');
    });

    it('should handle partial failures in batch', async () => {
      mockChannel.sendToQueue
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);

      const messages: QueueMessage<{ data: string }>[] = [
        { body: { data: 'msg1' } },
        { body: { data: 'msg2' } },
      ];

      const results = await provider.publishBatch('test-queue', messages);

      expect(results).toHaveLength(2);
      expect(results[0]).toHaveProperty('success', true);
      expect(results[1]).toHaveProperty('success', false);
    });

    it('should return empty array for empty messages', async () => {
      const results = await provider.publishBatch('test-queue', []);

      expect(results).toEqual([]);
      expect(mockChannel.sendToQueue).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should subscribe to a queue successfully', async () => {
      const handler = jest.fn();
      await provider.subscribe('test-queue', handler);

      expect(mockChannel.consume).toHaveBeenCalledWith(
        'test-queue',
        expect.any(Function),
        {
          noAck: false,
        },
      );
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      await expect(provider.subscribe('test-queue', jest.fn())).rejects.toThrow(
        'RabbitMQ client is not connected',
      );
    });

    it('should throw error when subscribing twice to the same queue', async () => {
      const handler = jest.fn();
      await provider.subscribe('test-queue', handler);

      await expect(provider.subscribe('test-queue', handler)).rejects.toThrow(
        'Already subscribed to queue: test-queue',
      );

      expect(mockChannel.consume).toHaveBeenCalledTimes(1);
    });

    it('should call handler when message is received', async () => {
      const handler = jest.fn();
      let consumeCallback: (msg: amqplib.ConsumeMessage | null) => void;

      mockChannel.consume.mockImplementation((queue, callback) => {
        consumeCallback = callback as (
          msg: amqplib.ConsumeMessage | null,
        ) => void;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      });

      await provider.subscribe('test-queue', handler);

      // Simulate message received
      const mockMessage = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-123', body: { data: 'test' } }),
        ),
        properties: {
          messageId: 'msg-123',
          headers: {},
        },
        fields: {
          deliveryTag: 1,
        },
      } as unknown as amqplib.ConsumeMessage;

      consumeCallback!(mockMessage);

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'msg-123',
          body: { data: 'test' },
          queueName: 'test-queue',
        }),
      );
    });

    it('should acknowledge message after successful processing', async () => {
      const handler = jest.fn();
      let consumeCallback: (msg: amqplib.ConsumeMessage | null) => void;

      mockChannel.consume.mockImplementation((queue, callback) => {
        consumeCallback = callback as (
          msg: amqplib.ConsumeMessage | null,
        ) => void;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      });

      await provider.subscribe('test-queue', handler);

      const mockMessage = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-123', body: { data: 'test' } }),
        ),
        properties: { messageId: 'msg-123', headers: {} },
        fields: { deliveryTag: 1 },
      } as unknown as amqplib.ConsumeMessage;

      consumeCallback!(mockMessage);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockChannel.ack).toHaveBeenCalledWith(mockMessage);
    });

    it('should nack message on handler error', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('Handler error'));
      let consumeCallback: (msg: amqplib.ConsumeMessage | null) => void;

      mockChannel.consume.mockImplementation((queue, callback) => {
        consumeCallback = callback as (
          msg: amqplib.ConsumeMessage | null,
        ) => void;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      });

      await provider.subscribe('test-queue', handler);

      const mockMessage = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-123', body: { data: 'test' } }),
        ),
        properties: { messageId: 'msg-123', headers: {} },
        fields: { deliveryTag: 1 },
      } as unknown as amqplib.ConsumeMessage;

      consumeCallback!(mockMessage);

      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockChannel.nack).toHaveBeenCalledWith(mockMessage, false, true);
    });

    it('should handle null message gracefully', async () => {
      const handler = jest.fn();
      let consumeCallback: (msg: amqplib.ConsumeMessage | null) => void;

      mockChannel.consume.mockImplementation((queue, callback) => {
        consumeCallback = callback as (
          msg: amqplib.ConsumeMessage | null,
        ) => void;
        return Promise.resolve({ consumerTag: 'test-consumer' });
      });

      await provider.subscribe('test-queue', handler);

      // Simulate null message (consumer cancelled)
      consumeCallback!(null);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should unsubscribe from a queue successfully', async () => {
      const handler = jest.fn();
      await provider.subscribe('test-queue', handler);
      await provider.unsubscribe('test-queue');

      expect(mockChannel.cancel).toHaveBeenCalledWith('test-consumer-tag');
    });

    it('should do nothing if not subscribed to queue', async () => {
      await provider.unsubscribe('non-existent-queue');

      expect(mockChannel.cancel).not.toHaveBeenCalled();
    });
  });

  describe('receive', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should receive a single message', async () => {
      const mockMessage = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-123', body: { data: 'test' } }),
        ),
        properties: {
          messageId: 'msg-123',
          headers: { 'x-custom': 'value' },
        },
        fields: {
          deliveryTag: 1,
        },
      };

      mockChannel.get
        .mockResolvedValueOnce(mockMessage)
        .mockResolvedValueOnce(false);

      const messages = await provider.receive('test-queue', 1);

      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({
        id: 'msg-123',
        body: { data: 'test' },
        receiptHandle: '1',
        queueName: 'test-queue',
        attributes: { 'x-custom': 'value' },
      });
    });

    it('should receive multiple messages', async () => {
      const mockMessage1 = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-1', body: { data: 'msg1' } }),
        ),
        properties: { messageId: 'msg-1', headers: {} },
        fields: { deliveryTag: 1 },
      };
      const mockMessage2 = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-2', body: { data: 'msg2' } }),
        ),
        properties: { messageId: 'msg-2', headers: {} },
        fields: { deliveryTag: 2 },
      };

      mockChannel.get
        .mockResolvedValueOnce(mockMessage1)
        .mockResolvedValueOnce(mockMessage2)
        .mockResolvedValueOnce(false);

      const messages = await provider.receive('test-queue', 10);

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe('msg-1');
      expect(messages[1].id).toBe('msg-2');
    });

    it('should return empty array when no messages available', async () => {
      mockChannel.get.mockResolvedValue(false);

      const messages = await provider.receive('test-queue', 5);

      expect(messages).toEqual([]);
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      await expect(provider.receive('test-queue')).rejects.toThrow(
        'RabbitMQ client is not connected',
      );
    });

    it('should use config maxMessages when not provided', async () => {
      const configWithMaxMessages = {
        ...defaultConfig,
        maxMessages: 3,
      };
      provider = new RabbitMqQueueProvider(configWithMaxMessages);
      await provider.connect();

      // Return messages for all attempts to verify maxMessages is being used
      const mockMessage = {
        content: Buffer.from(
          JSON.stringify({ id: 'msg-1', body: { data: 'test' } }),
        ),
        properties: { messageId: 'msg-1', headers: {} },
        fields: { deliveryTag: 1 },
      };

      mockChannel.get.mockResolvedValue(mockMessage);

      await provider.receive('test-queue');

      // Should attempt to get up to 3 messages (config maxMessages)
      expect(mockChannel.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('acknowledge', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should acknowledge a message successfully', async () => {
      await provider.acknowledge('test-queue', '123');

      expect(mockChannel.ack).toHaveBeenCalledWith(
        expect.objectContaining({
          fields: { deliveryTag: 123 },
        }),
      );
    });

    it('should throw error when not connected', () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      expect(() => provider.acknowledge('test-queue', '123')).toThrow(
        'RabbitMQ client is not connected',
      );
    });
  });

  describe('acknowledgeBatch', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should acknowledge multiple messages successfully', async () => {
      await provider.acknowledgeBatch('test-queue', ['1', '2', '3']);

      expect(mockChannel.ack).toHaveBeenCalledTimes(3);
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      await expect(
        provider.acknowledgeBatch('test-queue', ['1', '2']),
      ).rejects.toThrow('RabbitMQ client is not connected');
    });
  });

  describe('createQueue', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should create a queue successfully', async () => {
      const result = await provider.createQueue('new-queue');

      expect(result).toBe('new-queue');
      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'new-queue',
        expect.objectContaining({
          durable: true,
        }),
      );
    });

    it('should create a queue with custom options', async () => {
      await provider.createQueue('new-queue', {
        durable: false,
        autoDelete: true,
      });

      expect(mockChannel.assertQueue).toHaveBeenCalledWith(
        'new-queue',
        expect.objectContaining({ durable: false, autoDelete: true }),
      );
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      await expect(provider.createQueue('new-queue')).rejects.toThrow(
        'RabbitMQ client is not connected',
      );
    });
  });

  describe('deleteQueue', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should delete a queue successfully', async () => {
      await provider.deleteQueue('test-queue');

      expect(mockChannel.deleteQueue).toHaveBeenCalledWith('test-queue');
    });

    it('should throw error when not connected', async () => {
      provider = new RabbitMqQueueProvider(defaultConfig);

      await expect(provider.deleteQueue('test-queue')).rejects.toThrow(
        'RabbitMQ client is not connected',
      );
    });
  });

  describe('getQueueUrl', () => {
    it('should return the queue name as URL', async () => {
      const url = await provider.getQueueUrl('test-queue');

      expect(url).toBe('test-queue');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when connected', async () => {
      await provider.connect();

      const health = await provider.healthCheck();

      expect(health).toEqual({
        healthy: true,
        details: expect.objectContaining({
          provider: 'rabbitmq',
        }) as Record<string, unknown>,
      });
    });

    it('should return unhealthy when not connected', async () => {
      const health = await provider.healthCheck();

      expect(health).toEqual({
        healthy: false,
        details: expect.objectContaining({
          provider: 'rabbitmq',
          error: expect.any(String) as unknown as string,
        }) as Record<string, unknown>,
      });
    });

    it('should mask credentials in connection URL', async () => {
      await provider.connect();

      const health = await provider.healthCheck();

      expect(health.details?.connectionUrl).toContain('*****');
    });
  });

  describe('providerType', () => {
    it('should return rabbitmq as provider type', () => {
      expect(provider.providerType).toBe('rabbitmq');
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      await provider.connect();
    });

    it('should handle very large message payload', async () => {
      const largePayload = { data: 'x'.repeat(100000) };
      const message: QueueMessage<typeof largePayload> = { body: largePayload };

      const result = await provider.publish('test-queue', message);

      expect(result.success).toBe(true);
      expect(mockChannel.sendToQueue).toHaveBeenCalled();
    });

    it('should preserve message order in batch publish', async () => {
      const messages: QueueMessage<{ order: number }>[] = [
        { body: { order: 1 } },
        { body: { order: 2 } },
        { body: { order: 3 } },
      ];

      await provider.publishBatch('test-queue', messages);

      const calls = mockChannel.sendToQueue.mock.calls;
      expect(JSON.parse(calls[0][1].toString())).toHaveProperty(
        'body.order',
        1,
      );
      expect(JSON.parse(calls[1][1].toString())).toHaveProperty(
        'body.order',
        2,
      );
      expect(JSON.parse(calls[2][1].toString())).toHaveProperty(
        'body.order',
        3,
      );
    });

    it('should handle message with all optional fields', async () => {
      const message: QueueMessage<{ data: string }> = {
        id: 'custom-id',
        body: { data: 'test' },
        attributes: { 'x-custom': 'value' },
        delaySeconds: 30,
        groupId: 'group-1',
        deduplicationId: 'dedup-1',
      };

      const result = await provider.publish('test-queue', message);

      expect(result.messageId).toBe('custom-id');
      expect(result.success).toBe(true);
    });

    it('should only assert queue once for multiple operations', async () => {
      const message: QueueMessage<{ data: string }> = {
        body: { data: 'test' },
      };

      // First publish should assert the queue
      await provider.publish('test-queue', message);
      // Second publish should not assert again
      await provider.publish('test-queue', message);

      // assertQueue is called once for the initial queue creation
      const assertQueueCalls = mockChannel.assertQueue.mock.calls.filter(
        (call) => call[0] === 'test-queue',
      );
      expect(assertQueueCalls).toHaveLength(1);
    });
  });
});
