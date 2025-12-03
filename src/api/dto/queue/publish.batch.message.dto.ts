import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for publishing a batch of messages to a queue
 */
export class PublishBatchMessageDto {
  @ApiProperty({
    description: 'The name of the queue to publish to',
    example: 'my-queue',
  })
  @IsString()
  queueName: string;

  @ApiProperty({
    description: 'The messages to publish',
    type: 'array',
    items: {
      type: 'object',
      properties: {
        body: { type: 'object' },
        attributes: { type: 'object' },
        delaySeconds: { type: 'number' },
      },
    },
  })
  messages: Array<{
    body: unknown;
    attributes?: Record<string, string>;
    delaySeconds?: number;
    groupId?: string;
    deduplicationId?: string;
  }>;

  @ApiPropertyOptional({
    description: 'Provider name to use (uses default if not specified)',
    example: 'sqs',
  })
  @IsOptional()
  @IsString()
  providerName?: string;
}
