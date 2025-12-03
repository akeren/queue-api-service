# Queue Service API 

This is a NestJS API Service for publishing and subscribing to messages on multiple queue providers at scale. The service supports AWS SQS, RabbitMQ, and an in-memory provider for testing in the development environment. 

## Features

- **Multiple Queue Providers**: Support for AWS SQS, RabbitMQ, and In-Memory queues. 
- **Dynamic Configuration**: Switch between providers using environment variables (no code changes required).
- **Multi-Provider Support**: Use multiple queue providers simultaneously. 
- **12-Factor App Compliant**: Configuration via environment variables.
- **Docker Ready**: Includes Docker Compose with LocalStack (SQS) and RabbitMQ.
- **OpenAPI Documentation**: Full Swagger API documentation.
- **Health Checks**: Built-in health endpoints for all providers. 
- **Testable**: In-memory provider for easy testing. 

## Architecture

<img src="./img/Architecture.png" />

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm
- Docker & Docker Compose (for running with SQS/RabbitMQ)

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment file
cp .env.example .env
```

### Running the Application

#### Development Mode (In-Memory Queue)

```bash
# Uses in-memory provider by default
pnpm run start:dev
```

#### With Docker Compose (SQS + RabbitMQ)

```bash
# Start all services (API, LocalStack, RabbitMQ)
docker-compose up -d

# Or run only the infrastructure
docker-compose up -d localstack rabbitmq

# Then run the API locally with multiple providers
QUEUE_PROVIDERS=sqs,rabbitmq pnpm run start:dev
```

### API Documentation

Once running, access Swagger documentation at: http://localhost:4000/api

## Configuration

### Environment Variables

| Variable | Description | value |
|----------|-------------|---------|
| `APP_ENV` | Environment (development, production) | `development` |
| `APP_PORT` | Application port | `4000` |
| `QUEUE_PROVIDER` | Single queue provider type | `in-memory` |
| `QUEUE_PROVIDERS` | Multiple providers (comma-separated) | `sqs,rabbitmq,in-memory` |
| `QUEUE_MAX_MESSAGES` | Max messages per receive | `10` |
| `QUEUE_VISIBILITY_TIMEOUT_IN_SECONDS` | Visibility timeout (seconds) | `30` |
| `QUEUE_WAIT_TIME_IN_SECONDS` | Long polling wait time (seconds) | `20` |
| `QUEUE_HEALTH_CHECKS` | Enable health checks for queues | `true` or `false` |
| `AWS_LOCALSTACK_PORT` | Local stack port | `4566` |
| `AWS_REGION` | AWS region | `eu-west-1` |
| `AWS_ACCESS_KEY_ID` | AWS access key | `test` |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | `test` |
| `AWS_SQS_ENDPOINT` | For LocalStack SQS endpoint | `http://localstack:4566` |
| `RABBITMQ_PORT` | RabbitMQ port | `5672` |
| `RABBITMQ_MANAGEMENT_PORT` | For management UI | `15672` |
| `RABBITMQ_DEFAULT_USER` | RabbitMQ default user | `guest` |
| `RABBITMQ_DEFAULT_PASS` | RabbitMQ default password | `guest` |
| `RABBITMQ_URL` | RabbitMQ connection URL | `amqp://guest:guest@localhost:5672` |

### Provider Selection

#### Single Provider

```bash
# Use SQS only
QUEUE_PROVIDER=sqs

# Use RabbitMQ only
QUEUE_PROVIDER=rabbitmq

# Use in-memory (for testing)
QUEUE_PROVIDER=in-memory
```

#### Multiple Providers

```bash
# Use both SQS and RabbitMQ
QUEUE_PROVIDERS=sqs,rabbitmq # First provider listed becomes the default
```

## API Endpoints

### Publish Messages

```bash
# Publish a single message
curl -X POST http://localhost:400/queue/publish \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "body": {"event": "account.created", "userId": "da0c7d93-149f-4b9a-b40e-ca976ebb0887"}
  }'

# Publish to a specific provider
curl -X POST http://localhost:400/queue/publish \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "body": {"event": "user.created"},
    "providerName": "rabbitmq"
  }'

# Publish to all providers (fanout)
curl -X POST http://localhost:400/queue/publish-all \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "body": {"event": "user.created"}
  }'

# Batch publish
curl -X POST http://localhost:400/queue/publish-batch \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "messages": [
      {"body": {"event": "msg1"}},
      {"body": {"event": "msg2"}}
    ]
  }'
```

### Receive Messages

```bash
# Receive messages
curl -X POST http://localhost:400/queue/receive \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "maxMessages": 5
  }'

# Acknowledge a message
curl -X POST http://localhost:400/queue/acknowledge \
  -H "Content-Type: application/json" \
  -d '{
    "queueName": "my-first-queue",
    "receiptHandle": "..."
  }'
```

### Queue Management

```bash
# Create a queue
curl -X POST http://localhost:400/queue/create \
  -H "Content-Type: application/json" \
  -d '{"queueName": "new-queue"}'

# Delete a queue
curl -X DELETE http://localhost:400/queue/my-first-queue

# List providers
curl http://localhost:400/queue/providers
```

### Health Checks

```bash
# Check all providers
curl http://localhost:400/queue/health

# Check specific provider
curl http://localhost:400/queue/health/sqs
```

## Testing

### Run Tests

```bash
# Unit tests
pnpm run test

# Watch mode
pnpm run test:watch

# Coverage
pnpm run test:cov

# E2E tests
pnpm run test:e2e
```

## Using Both Queues at Once

The service supports multiple queue providers simultaneously:

```bash
# Configure both providers
QUEUE_PROVIDERS=sqs,rabbitmq

# API calls can specify which provider to use
curl -X POST http://localhost:400/queue/publish \
  -d '{"queueName": "orders", "body": {...}, "providerName": "sqs"}'

curl -X POST http://localhost:400/queue/publish \
  -d '{"queueName": "notifications", "body": {...}, "providerName": "rabbitmq"}'

# Or publish to all providers at once
curl -X POST http://localhost:400/queue/publish-all \
  -d '{"queueName": "events", "body": {...}}'
```

## 12-Factor App Principles

The implemented queue srvice API follows the 12-factor app methodology:

1. **Codebase**: Single codebase in version control.
2. **Dependencies**: Explicitly declared in `package.json`.
3. **Config**: Stored in environment variables.
4. **Backing Services**: Queue providers are attached resources. 
5. **Build, Release, Run**: Dockerfile supports CI/CD. 
6. **Processes**: Stateless processes.
7. **Port Binding**: Self-contained HTTP server.
8. **Concurrency**: Horizontally scalable.
9. **Disposability**: Fast startup, graceful shutdown
10. **Dev/Prod Parity**: Docker Compose mirrors production. 
11. **Logs**: Streamed to stdout. 
12. **Admin Processes**: Health check endpoints

## Acknowledgements

I utilized AI as a critical friend, seeking feedback on performance metrics and critical reviews of my implementation to identify potential bottlenecks. The use of these models in no way completely replaces my imagination and creativity in crafting this solution; rather, they enhanced my ability to proactively spot issues and co-create responsibly. Below are the generative AI models consulted during the development of this solution:

- **Claude Opus 4.5**: Assisted with architectural reviews and optimization suggestions.
- **Grok Code Fast 1**: Provided rapid code debugging and efficiency insights.

 