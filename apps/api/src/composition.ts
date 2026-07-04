import {
  ConversationRepositoryPrisma,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  createDeepSeekJsonAdapter,
  createGlmJsonAdapter,
  createPrismaClient,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MessageDelegate,
  type RuntimeFetch,
} from '@digimaestro/adapters';
import type { LlmJsonPort, LlmUsageLoggerPort } from '@digimaestro/shared';
import type { ChatDeps } from './chat/handle-incoming.js';

export type LlmProviderName = 'deepseek' | 'glm';

export interface LlmEnv {
  readonly DIGIMAESTRO_LLM_PROVIDER?: string;
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
// Catatan cast: delegate Prisma (typed enum literal) tidak assignable struktural ke
// interface sempit repo (string) — perbedaan tipe enumer saja, bukan perilaku. Cast
// `as unknown as` di batas adapter ini aman: repo tetap menyuntik tenantId & teruji.
export function createChatDeps(): ChatDeps {
  const prisma = createPrismaClient();
  return {
    conversations: new ConversationRepositoryPrisma(prisma.conversation as unknown as ConversationDelegate),
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
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
