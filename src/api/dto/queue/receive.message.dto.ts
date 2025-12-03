import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

/**
 * DTO for receiving messages from a queue
 */
export class ReceiveMessagesDto {
  @ApiProperty({
    description: 'The name of the queue to receive from',
    example: 'my-queue',
  })
  @IsString()
  queueName: string;

  @ApiPropertyOptional({
    description: 'Maximum number of messages to receive',
    example: 10,
    minimum: 1,
    maximum: 10,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  maxMessages?: number;

  @ApiPropertyOptional({
    description: 'Provider name to use (uses default if not specified)',
    example: 'sqs',
  })
  @IsOptional()
  @IsString()
  providerName?: string;
}
