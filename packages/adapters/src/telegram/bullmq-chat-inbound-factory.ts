// Factory konkret ChatInboundQueuePort di atas bullmq Queue (T-030tg). Mengisolasi impor
// vendor bullmq dari BullMqChatInboundQueue yang tetap offline-testable via JobQueueClient.
//
// Retry: pesan masuk boleh di-retry (LLM/DB tersendat sesaat). Aman karena pemrosesan
// idempoten di lapis DB — providerMsgId @unique menahan balasan dobel bila job diulang
// setelah pesan IN sempat tercatat.

import { Queue, type ConnectionOptions } from 'bullmq';
import {
  CHAT_INBOUND_QUEUE_NAME,
  type ChatInboundQueuePort,
  type InboundRateLimiterPort,
} from '@digimaestro/shared';
import type { JobQueueClient } from '../publish/bullmq-publish-queue.js';
import { BullMqChatInboundQueue } from './bullmq-chat-inbound-queue.js';
import {
  RedisInboundRateLimiter,
  type InboundRateLimitOptions,
  type RedisRateCommands,
} from './redis-inbound-rate-limiter.js';

export function createBullMqChatInboundQueue(connection: ConnectionOptions): ChatInboundQueuePort {
  const queue = new Queue(CHAT_INBOUND_QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    },
  });
  const client: JobQueueClient = {
    add: (name, data) => queue.add(name, data as Record<string, unknown>),
  };
  return new BullMqChatInboundQueue(client);
}

// P0: limiter pesan masuk di atas Redis yang SAMA dengan antrean (tanpa dep baru).
// `Queue.client` = API publik BullMQ → memberi koneksi ioredis yang sudah ada.
export function createRedisInboundRateLimiter(
  connection: ConnectionOptions,
  options: InboundRateLimitOptions,
): InboundRateLimiterPort {
  const queue = new Queue(CHAT_INBOUND_QUEUE_NAME, { connection });
  return new RedisInboundRateLimiter(
    () => queue.client as unknown as Promise<RedisRateCommands>,
    options,
  );
}
