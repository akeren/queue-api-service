import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * DTO for acknowledging a message from a queue
 */
export class AcknowledgeMessageDto {
  @ApiProperty({
    description: 'The name of the queue from which the message was received',
    example: 'my-queue',
  })
  @IsString()
  queueName: string;

  @ApiProperty({
    description: 'The receipt handle of the message to acknowledge',
    example: 'AQEBwJnKyrHigUMZj6rYigCgxlaS3SLy0a...',
  })
  @IsString()
  receiptHandle: string;

  @ApiPropertyOptional({
    description: 'Provider name to use (uses default if not specified)',
    example: 'sqs',
  })
  @IsOptional()
  @IsString()
  providerName?: string;
}
