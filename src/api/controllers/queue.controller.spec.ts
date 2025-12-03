import { Test, TestingModule } from '@nestjs/testing';
import { QueueController } from './queue.controller';
import { QueueService } from '../../queue/queue.service';
import { PublishMessageDto, ReceiveMessagesDto } from '../dto/queue';

describe('QueueController', () => {
  let controller: QueueController;
  let queueService: jest.Mocked<QueueService>;

  beforeEach(async () => {
    const mockQueueService = {
      publish: jest.fn().mockResolvedValue({
        success: true,
        messageId: 'test-message-id',
      }),
      publishBatch: jest.fn().mockResolvedValue([
        { success: true, messageId: 'msg-1' },
        { success: true, messageId: 'msg-2' },
      ]),
      publishToAll: jest.fn().mockResolvedValue({
        provider1: { success: true, messageId: 'msg-1' },
      }),
      receive: jest.fn().mockResolvedValue([
        {
          id: 'msg-1',
          body: { test: 'data' },
          receiptHandle: 'handle-1',
          receivedAt: new Date(),
          queueName: 'test-queue',
        },
      ]),
      acknowledge: jest.fn().mockResolvedValue(undefined),
      createQueue: jest.fn().mockResolvedValue('test-queue-url'),
      deleteQueue: jest.fn().mockResolvedValue(undefined),
      getProviderNames: jest.fn().mockReturnValue(['sqs', 'rabbitmq']),
      healthCheck: jest.fn().mockResolvedValue({
        healthy: true,
        details: { provider: 'sqs' },
      }),
      healthCheckAll: jest.fn().mockResolvedValue({
        sqs: { healthy: true },
        rabbitmq: { healthy: true },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [QueueController],
      providers: [
        {
          provide: QueueService,
          useValue: mockQueueService,
        },
      ],
    }).compile();

    controller = module.get<QueueController>(QueueController);
    queueService = module.get(QueueService);
  });

  describe('publishMessage', () => {
    it('should publish a message', async () => {
      const dto: PublishMessageDto = {
        queueName: 'test-queue',
        body: { test: 'data' },
      };

      const result = await controller.publishMessage(dto);

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('test-message-id');
      expect(queueService.publish.mock.calls[0]).toEqual([
        'test-queue',
        expect.objectContaining({ body: { test: 'data' } }),
        undefined,
      ]);
    });

    it('should pass provider name when specified', async () => {
      const dto: PublishMessageDto = {
        queueName: 'test-queue',
        body: { test: 'data' },
        providerName: 'sqs',
      };

      await controller.publishMessage(dto);

      expect(queueService.publish.mock.calls[0]).toEqual([
        'test-queue',
        expect.anything(),
        'sqs',
      ]);
    });
  });

  describe('publishBatchMessages', () => {
    it('should publish multiple messages', async () => {
      const dto = {
        queueName: 'test-queue',
        messages: [{ body: { index: 1 } }, { body: { index: 2 } }],
      };

      const result = await controller.publishBatchMessages(dto);

      expect(result.totalMessages).toBe(2);
      expect(result.successful).toBe(2);
      expect(result.failed).toBe(0);
    });
  });

  describe('publishToAllProviders', () => {
    it('should publish to all providers', async () => {
      const dto: PublishMessageDto = {
        queueName: 'test-queue',
        body: { test: 'fanout' },
      };

      const result = await controller.publishToAllProviders(dto);

      expect(result.results).toBeDefined();
      expect(queueService.publishToAll.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('receiveMessages', () => {
    it('should receive messages', async () => {
      const dto: ReceiveMessagesDto = {
        queueName: 'test-queue',
      };

      const result = await controller.receiveMessages(dto);

      expect(result.messageCount).toBe(1);
      expect(result.messages[0].body).toEqual({ test: 'data' });
    });

    it('should pass maxMessages parameter', async () => {
      const dto: ReceiveMessagesDto = {
        queueName: 'test-queue',
        maxMessages: 5,
      };

      await controller.receiveMessages(dto);

      expect(queueService.receive.mock.calls[0]).toEqual([
        'test-queue',
        5,
        undefined,
      ]);
    });
  });

  describe('acknowledgeMessage', () => {
    it('should acknowledge a message', async () => {
      const dto = {
        queueName: 'test-queue',
        receiptHandle: 'handle-1',
      };

      const result = await controller.acknowledgeMessage(dto);

      expect(result.success).toBe(true);
      expect(queueService.acknowledge.mock.calls[0]).toEqual([
        'test-queue',
        'handle-1',
        undefined,
      ]);
    });
  });

  describe('createQueue', () => {
    it('should create a queue', async () => {
      const dto = {
        queueName: 'new-queue',
      };

      const result = await controller.createQueue(dto);

      expect(result.success).toBe(true);
      expect(result.queueUrl).toBe('test-queue-url');
    });
  });

  describe('deleteQueue', () => {
    it('should delete a queue', async () => {
      const result = await controller.deleteQueue('test-queue');

      expect(result.success).toBe(true);
      expect(queueService.deleteQueue.mock.calls[0]).toEqual([
        'test-queue',
        undefined,
      ]);
    });
  });

  describe('getProviders', () => {
    it('should return list of providers', () => {
      const result = controller.getProviders();

      expect(result.providers).toEqual(['sqs', 'rabbitmq']);
    });
  });

  describe('healthCheck', () => {
    it('should return overall health status', async () => {
      const result = await controller.healthCheck();

      expect(result.status).toBe('healthy');
      expect(result.providers).toBeDefined();
    });

    it('should return unhealthy when any provider is unhealthy', async () => {
      queueService.healthCheckAll.mockResolvedValueOnce({
        sqs: { healthy: true },
        rabbitmq: { healthy: false },
      });

      const result = await controller.healthCheck();

      expect(result.status).toBe('unhealthy');
    });
  });

  describe('healthCheckProvider', () => {
    it('should return health status for specific provider', async () => {
      const result = await controller.healthCheckProvider('sqs');

      expect(result.provider).toBe('sqs');
      expect(result.healthy).toBe(true);
    });
  });
});
