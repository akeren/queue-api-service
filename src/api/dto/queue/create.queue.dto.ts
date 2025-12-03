import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';

/**
 * DTO for creating a new queue
 */
export class CreateQueueDto {
  @ApiProperty({
    description: 'The name of the queue to create',
    example: 'my-new-queue',
  })
  @IsString()
  queueName: string;

  @ApiPropertyOptional({
    description:
      'Optional configuration options for the queue as key-value pairs',
    example: { visibilityTimeout: 60 },
  })
  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Provider name to use (uses default if not specified)',
    example: 'sqs',
  })
  @IsOptional()
  @IsString()
  providerName?: string;
}
