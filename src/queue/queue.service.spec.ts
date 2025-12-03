import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from './queue.service';
import { QueueProviderFactory, InMemoryQueueProvider } from './providers';

describe('QueueService', () => {
  let service: QueueService;
  let providerFactory: QueueProviderFactory;
  let inMemoryProvider: InMemoryQueueProvider;

  beforeEach(async () => {
    // Create a mock in-memory provider
    inMemoryProvider = new InMemoryQueueProvider({
      name: 'test',
      maxMessages: 10,
      visibilityTimeout: 30,
      waitTimeSeconds: 1,
    });
    await inMemoryProvider.connect();

    // Create mock provider factory
    providerFactory = {
      getProvider: jest.fn().mockReturnValue(inMemoryProvider),
      getProviderNames: jest.fn().mockReturnValue(['test']),
      healthCheckAll: jest.fn().mockResolvedValue({
        test: { healthy: true, details: { provider: 'in-memory' } },
      }),
    } as unknown as QueueProviderFactory;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        {
          provide: QueueProviderFactory,
          useValue: providerFactory,
        },
      ],
    }).compile();

    service = module.get<QueueService>(QueueService);
  });

  afterEach(async () => {
    await inMemoryProvider.disconnect();
  });

  describe('publish', () => {
    it('should publish a message', async () => {
      const result = await service.publish('test-queue', {
        body: { test: 'data' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    it('should use the specified provider', async () => {
      await service.publish('test-queue', { body: { test: 'data' } }, 'test');

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(providerFactory.getProvider).toHaveBeenCalledWith('test');
    });
  });

  describe('publishBatch', () => {
    it('should publish multiple messages', async () => {
      const messages = [
        { body: { index: 1 } },
        { body: { index: 2 } },
        { body: { index: 3 } },
      ];

      const results = await service.publishBatch('test-queue', messages);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe('receive', () => {
    it('should receive messages', async () => {
      await service.publish('test-queue', { body: { test: 'data' } });

      const messages = await service.receive('test-queue');

      expect(messages).toHaveLength(1);
      expect(messages[0].body).toEqual({ test: 'data' });
    });

    it('should respect maxMessages parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await service.publish('test-queue', { body: { index: i } });
      }

      const messages = await service.receive('test-queue', 2);

      expect(messages).toHaveLength(2);
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge a message', async () => {
      await service.publish('test-queue', { body: { test: 'data' } });
      const messages = await service.receive('test-queue');

      await expect(
        service.acknowledge('test-queue', messages[0].receiptHandle),
      ).resolves.not.toThrow();
    });
  });

  describe('createQueue/deleteQueue', () => {
    it('should create a queue', async () => {
      const queueUrl = await service.createQueue('new-queue');
      expect(queueUrl).toBe('new-queue');
    });

    it('should delete a queue', async () => {
      await service.createQueue('to-delete');
      await expect(service.deleteQueue('to-delete')).resolves.not.toThrow();
    });
  });

  describe('healthCheck', () => {
    it('should check health of a specific provider', async () => {
      const health = await service.healthCheck();

      expect(health.healthy).toBe(true);
    });

    it('should check health of all providers', async () => {
      const health = await service.healthCheckAll();

      expect(health.test).toBeDefined();
      expect(health.test.healthy).toBe(true);
    });
  });

  describe('getProviderNames', () => {
    it('should return list of provider names', () => {
      const names = service.getProviderNames();

      expect(names).toContain('test');
    });
  });

  describe('publishToAll', () => {
    it('should publish to all providers', async () => {
      const results = await service.publishToAll('test-queue', {
        body: { test: 'fanout' },
      });

      expect(results.test).toBeDefined();
      expect(results.test.success).toBe(true);
    });
  });
});
