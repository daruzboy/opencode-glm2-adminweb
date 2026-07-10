import {
  ConversationRepositoryPrisma,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  createDeepSeekJsonAdapter,
  createDeterministicLlmAgentAdapter,
  createGlmJsonAdapter,
  createPrismaClient,
  PreviewPortPrisma,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MessageDelegate,
  type RevisionPreviewDelegate,
  type RuntimeFetch,
} from '@digimaestro/adapters';
import { createAgentReplier, createAgentToolRegistry, type ConversationReplier } from '@digimaestro/core';
import type { ConversationRepository, LlmAgentResponse, LlmJsonPort, LlmUsageLoggerPort } from '@digimaestro/shared';
import type { ChatDeps } from './chat/handle-incoming.js';
import type { PreviewDeps } from './preview/handle-preview.js';

export type LlmProviderName = 'deepseek' | 'glm';

export interface LlmEnv {
  readonly DIGIMAESTRO_LLM_PROVIDER?: string;
  readonly DIGIMAESTRO_AGENT_LOOP?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_MODEL?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  readonly GLM_API_KEY?: string;
  readonly GLM_MODEL?: string;
  readonly GLM_BASE_URL?: string;
}

export interface CreateLlmJsonPortOptions {
  readonly env?: LlmEnv;
  readonly fetch?: RuntimeFetch;
  readonly usageLogger?: LlmUsageLoggerPort;
}

// Composition root (apps/api): instantiate adapter konkret & suntikkan ke use case
// (SOLID-D). Prisma client di-guard tenantId via $extends (T-021). Dipanggil saat
// buildServer tanpa deps eksplisit (server nyata, butuh DATABASE_URL); test menyuntik
// deps fake sehingga tanpa DB.
//
// T-053: agent loop (ConversationReplier) digated env DIGIMAESTRO_AGENT_LOOP=1. Saat
// OFF (default) → balasan memakai stubReply (perilaku lama tak berubah). Saat ON →
// replier = router (intent keyword-only, tanpa API key) + agent loop dengan adapter
// deterministik. Adapter HTTP tool-calling vendor nyata menyusul (butuh API key).
//
// Catatan cast: delegate Prisma (typed enum literal) tidak assignable struktural ke
// interface sempit repo (string) — perbedaan tipe enumer saja, bukan perilaku. Cast
// `as unknown as` di batas adapter ini aman: repo tetap menyuntik tenantId & teruji.
export function createChatDeps(options: CreateChatDepsOptions = {}): ChatDeps {
  const env = options.env ?? process.env;
  const prisma = createPrismaClient();
  const conversations = new ConversationRepositoryPrisma(
    prisma.conversation as unknown as ConversationDelegate,
  );
  const messages = new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate);

  const enableAgentLoop = options.enableAgentLoop ?? env.DIGIMAESTRO_AGENT_LOOP === '1';
  if (!enableAgentLoop) return { conversations, messages };

  const reply = createDeterministicAgentReplier(conversations);
  return { conversations, messages, reply };
}

export interface CreatePreviewDepsOptions {
  // Override utk test/dev (fake delegate); default = Prisma client nyata.
  readonly prisma?: { revision: RevisionPreviewDelegate };
  readonly tokenSecret?: string;
}

// Composition preview draft (T-064): adapter Prisma Revision + token stateless HMAC.
// Butuh PREVIEW_TOKEN_SECRET (rahasia server; rotasi = revoke semua preview). Revision
// tak ter-scope tenant langsung → query by id aman terhadap tenantGuardExtension.
export function createPreviewDeps(options: CreatePreviewDepsOptions = {}): PreviewDeps {
  const secret = options.tokenSecret ?? process.env.PREVIEW_TOKEN_SECRET;
  if (!secret) throw new Error('PREVIEW_TOKEN_SECRET wajib diisi untuk mengaktifkan rute preview draft');
  const prisma = options.prisma ?? createPrismaClient();
  const preview = new PreviewPortPrisma(prisma.revision as unknown as RevisionPreviewDelegate, secret);
  return { preview };
}

export interface CreateChatDepsOptions {
  readonly env?: LlmEnv;
  readonly enableAgentLoop?: boolean;
}

// Replier v0: router (intent keyword-only) + agent loop deterministik. Tidak butuh
// API key/jaringan → cocok untuk dev/staging. Produksi nyata = ganti adapter
// deterministik dengan adapter HTTP tool-calling vendor (follow-up T-053b setelah API
// key DeepSeek/GLM tersedia).
export function createDeterministicAgentReplier(conversations: ConversationRepository): ConversationReplier {
  return createAgentReplier({
    router: { conversations },
    loop: {
      llm: createDeterministicLlmAgentAdapter({ responder: deterministicAgentResponder }),
      tools: createAgentToolRegistry([]),
    },
  });
}

// Responder deterministik dev: balas teks ringkas berdasarkan task. Bukan balasan
// produksi — hanya membuktikan loop nyambung end-to-end tanpa vendor.
function deterministicAgentResponder(): LlmAgentResponse {
  return {
    kind: 'text',
    content:
      'Hai! Aku udah catat pesan kamu. Agent AI produksi lagi disiapin — sementara ' +
      'ini, cerita singkat ya: nama usaha dan website seperti apa yang kamu mau?',
  };
}

export function createLlmJsonPort(options: CreateLlmJsonPortOptions = {}): LlmJsonPort {
  const env = options.env ?? process.env;
  const provider = parseLlmProvider(env.DIGIMAESTRO_LLM_PROVIDER);
  const usageLogger = options.usageLogger ?? createPrismaLlmUsageLogger();

  if (provider === 'glm') {
    return createGlmJsonAdapter({
      model: env.GLM_MODEL ?? 'glm-4.5',
      apiKey: env.GLM_API_KEY ?? '',
      baseUrl: env.GLM_BASE_URL,
      fetch: options.fetch,
      usageLogger,
    });
  }

  return createDeepSeekJsonAdapter({
    model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEEPSEEK_BASE_URL,
    fetch: options.fetch,
    usageLogger,
  });
}

function createPrismaLlmUsageLogger(): LlmUsageLoggerPort {
  const prisma = createPrismaClient();
  return new LlmUsageLoggerPrisma(prisma.llmUsage as unknown as LlmUsageDelegate);
}

function parseLlmProvider(value: string | undefined): LlmProviderName {
  return value === 'glm' ? 'glm' : 'deepseek';
}
