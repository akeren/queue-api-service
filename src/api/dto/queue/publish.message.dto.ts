import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDefined,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

/**
 * DTO for publishing a message to a queue
 */
export class PublishMessageDto {
  @ApiProperty({
    description: 'The name of the queue to publish to',
    example: 'my-queue',
  })
  @IsString()
  queueName: string;

  @ApiProperty({
    description: 'The message body/content to publish to the queue',
    example: {
      event: 'account.created',
      userId: '472a2c23-6bbd-49d1-9bc8-1a1fecff5621',
    },
  })
  @IsDefined()
  body: unknown;

  @ApiPropertyOptional({
    description: 'Optional message attributes/headers as key-value pairs',
    example: { correlationId: 'abc-123' },
  })
  @IsOptional()
  @IsObject()
  attributes?: Record<string, string>;

  @ApiPropertyOptional({
    description: 'Delay in seconds before the message becomes visible',
    example: 60,
    minimum: 0,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  delaySeconds?: number;

  @ApiPropertyOptional({
    description: 'Message group ID (for FIFO queues) only',
    example: 'group-1',
  })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({
    description:
      'Deduplication ID (for FIFO queues) only. Not needed if content-based deduplication is enabled for the queue (e.g., AWS SQS)',
    example: 'dedup-12345',
  })
  @IsOptional()
  @IsString()
  deduplicationId?: string;

  @ApiPropertyOptional({
    description: 'Provider name to use (uses default if not specified)',
    example: 'sqs',
  })
  @IsOptional()
  @IsString()
  providerName?: string;
}
