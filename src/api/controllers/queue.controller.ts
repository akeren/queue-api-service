import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { QueueService } from '../../queue';
import {
  PublishMessageDto,
  PublishBatchMessageDto,
  ReceiveMessagesDto,
  AcknowledgeMessageDto,
  CreateQueueDto,
} from '../dto/queue';

@ApiTags('Queue')
@Controller('queue')
export class QueueController {
  private readonly logger = new Logger(QueueController.name);

  constructor(private readonly queueService: QueueService) {}

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a message to a queue' })
  @ApiResponse({ status: 200, description: 'Message published successfully' })
  @ApiResponse({ status: 400, description: '' })
  async publishMessage(@Body() dto: PublishMessageDto) {
    const {
      queueName,
      providerName,
      body,
      attributes,
      delaySeconds,
      groupId,
      deduplicationId,
    } = dto;

    this.logger.log(`Publishing message to queue: ${queueName}`);

    const result = await this.queueService.publish(
      queueName,
      {
        body,
        attributes,
        delaySeconds,
        groupId,
        deduplicationId,
      },
      providerName,
    );

    return {
      success: result.success,
      messageId: result.messageId,
      sequenceNumber: result.sequenceNumber,
    };
  }

  @Post('publish-batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish multiple messages to a queue' })
  @ApiResponse({ status: 200, description: 'Messages published successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async publishBatchMessages(@Body() dto: PublishBatchMessageDto) {
    const { queueName, providerName, messages } = dto;

    this.logger.log(
      `Publishing ${messages.length} messages to queue: ${queueName}`,
    );

    const results = await this.queueService.publishBatch(
      queueName,
      messages.map((msg) => ({
        body: msg.body,
        attributes: msg.attributes,
        delaySeconds: msg.delaySeconds,
        groupId: msg.groupId,
        deduplicationId: msg.deduplicationId,
      })),
      providerName,
    );

    return {
      totalMessages: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
    };
  }

  @Post('publish-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a message to all configured providers' })
  @ApiResponse({
    status: 200,
    description: 'Message published to all providers',
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async publishToAllProviders(@Body() dto: PublishMessageDto) {
    const {
      queueName,
      body,
      attributes,
      delaySeconds,
      groupId,
      deduplicationId,
    } = dto;

    this.logger.log(
      `Publishing message to all providers for queue: ${queueName}`,
    );

    const results = await this.queueService.publishToAll(queueName, {
      body,
      attributes,
      delaySeconds,
      groupId,
      deduplicationId,
    });

    return { results };
  }

  @Post('receive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive messages from a queue' })
  @ApiResponse({ status: 200, description: 'Messages received successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async receiveMessages(@Body() dto: ReceiveMessagesDto) {
    const { queueName, maxMessages, providerName } = dto;

    this.logger.log(`Receiving messages from queue: ${queueName}`);

    const messages = await this.queueService.receive(
      queueName,
      maxMessages,
      providerName,
    );

    return {
      messageCount: messages.length,
      messages: messages.map((msg) => ({
        id: msg.id,
        body: msg.body,
        receiptHandle: msg.receiptHandle,
        receivedAt: msg.receivedAt,
        attributes: msg.attributes,
      })),
    };
  }

  @Post('acknowledge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge/delete a message from a queue' })
  @ApiResponse({
    status: 200,
    description: 'Message acknowledged successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async acknowledgeMessage(@Body() dto: AcknowledgeMessageDto) {
    const { queueName, receiptHandle, providerName } = dto;

    this.logger.log(`Acknowledging message from queue: ${queueName}`);

    await this.queueService.acknowledge(queueName, receiptHandle, providerName);

    return { success: true };
  }

  @Post('create')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new queue' })
  @ApiResponse({ status: 201, description: 'Queue created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request' })
  async createQueue(@Body() dto: CreateQueueDto) {
    const { queueName, options, providerName } = dto;

    this.logger.log(`Creating queue: ${queueName}`);

    const queueUrl = await this.queueService.createQueue(
      queueName,
      options,
      providerName,
    );

    return {
      success: true,
      queueName,
      queueUrl,
    };
  }

  @Delete(':queueName')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a queue' })
  @ApiQuery({ name: 'provider', required: false, description: 'Provider name' })
  @ApiResponse({ status: 200, description: 'Queue deleted successfully' })
  @ApiResponse({ status: 404, description: 'Queue not found' })
  async deleteQueue(
    @Param('queueName') queueName: string,
    @Query('provider') providerName?: string,
  ) {
    this.logger.log(`Deleting queue: ${queueName}`);

    await this.queueService.deleteQueue(queueName, providerName);

    return { success: true, queueName };
  }

  @Get('providers')
  @ApiOperation({ summary: 'Get list of configured queue providers' })
  @ApiResponse({ status: 200, description: 'List of providers' })
  getProviders() {
    const providers = this.queueService.getProviderNames();
    return { providers };
  }

  @Get('health')
  @ApiOperation({ summary: 'Health check for all queue providers' })
  @ApiResponse({ status: 200, description: 'Health status of all providers' })
  async healthCheck() {
    const healthStatus = await this.queueService.healthCheckAll();

    const allHealthy = Object.values(healthStatus).every((s) => s.healthy);

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      providers: healthStatus,
    };
  }

  @Get('health/:provider')
  @ApiOperation({ summary: 'Health check for a specific queue provider' })
  @ApiResponse({ status: 200, description: 'Health status of the provider' })
  async healthCheckProvider(@Param('provider') providerName: string) {
    const healthStatus = await this.queueService.healthCheck(providerName);

    return {
      provider: providerName,
      ...healthStatus,
    };
  }
}
