// T-030tg: adapter ChatInboundQueuePort via BullMQ (produsen). Webhook (apps/api)
// meng-enqueue pesan masuk → worker mengkonsumsi & memanggil LLM. Pola sama dengan
// antrean `publish` (T-063): kelas ini bergantung pada interface sempit JobQueueClient
// (bukan bullmq) → teruji offline; klien konkret dirakit di factory.

import { err, ok } from '@digimaestro/shared';
import {
  CHAT_INBOUND_QUEUE_NAME,
  type ChannelError,
  type ChatInboundJob,
  type ChatInboundQueuePort,
  type EnqueueInboundResult,
  type Result,
} from '@digimaestro/shared';
import type { JobQueueClient } from '../publish/bullmq-publish-queue.js';

export class BullMqChatInboundQueue implements ChatInboundQueuePort {
  constructor(private readonly queue: JobQueueClient) {}

  async enqueueInbound(job: ChatInboundJob): Promise<Result<EnqueueInboundResult, ChannelError>> {
    try {
      const added = await this.queue.add('chat-inbound', job);
      return ok({ jobId: added.id ?? 'unknown' });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err({ code: 'QUEUE', message: `gagal enqueue pesan masuk: ${message}` });
    }
  }
}

export { CHAT_INBOUND_QUEUE_NAME };
