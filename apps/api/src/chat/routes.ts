import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { tenantId } from '@digimaestro/shared';
import { handleIncoming, type ChatDeps } from './handle-incoming.js';
import { inboundMessageSchema, type InboundMessage } from './schema.js';

// Rute chat: REST riwayat + WS realtime (FR-CHN-003; SRS §9 /api/chat WS).
// REST: tenant via app.resolveTenant (JWT T-002auth, atau x-tenant-id fallback dev).
// WS: tenant via query `tenantId` (browser WS tak bisa set Authorization header) — token
// query WS = follow-up; guard T-021 tetap mencegah query lintas-tenant di lapis repo.

interface HistoryParams {
  conversationId: string;
}
interface ChatQuery {
  tenantId?: string;
  conversationId?: string;
}

export function registerChatRoutes(app: FastifyInstance, deps: ChatDeps): void {
  app.get(
    '/api/chat/:conversationId/messages',
    async (req: FastifyRequest<{ Params: HistoryParams }>, reply: FastifyReply) => {
      // T-002auth: tenant dari token JWT (atau x-tenant-id fallback dev). Null → 401.
      const { tenantId: tid } = await app.resolveTenant(req);
      if (!tid) {
        return reply.code(401).send({ error: 'unauthorized: token/tenant tidak valid' });
      }
      const result = await deps.messages.findManyByConversation(
        tid,
        req.params.conversationId,
      );
      if (!result.ok) return reply.code(500).send({ error: result.error.message });
      return reply.send(result.value);
    },
  );

  app.get('/api/chat', { websocket: true }, (socket, req) => {
    const query = (req.query as ChatQuery | undefined) ?? {};
    if (!query.tenantId || query.tenantId.length === 0) {
      socket.close(1008, 'missing tenantId');
      return;
    }
    const t = tenantId(query.tenantId);

    if (query.conversationId) {
      void deps.messages.findManyByConversation(t, query.conversationId).then((r) => {
        if (r.ok) {
          socket.send(
            JSON.stringify({
              type: 'history',
              conversationId: query.conversationId,
              messages: r.value,
            }),
          );
        }
      });
    }

    socket.on('message', (data: unknown) => {
      const raw = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
      let parsed: InboundMessage;
      try {
        parsed = inboundMessageSchema.parse(JSON.parse(raw));
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid payload' }));
        return;
      }
      void handleIncoming(deps, {
        tenantId: t,
        conversationId: parsed.conversationId,
        text: parsed.text,
      }).then((res) => {
        if (!res.ok) {
          socket.send(JSON.stringify({ type: 'error', message: res.error.message }));
          return;
        }
        socket.send(
          JSON.stringify({
            type: 'reply',
            conversationId: res.value.conversationId,
            message: res.value.outgoing,
          }),
        );
      });
    });
  });
}
