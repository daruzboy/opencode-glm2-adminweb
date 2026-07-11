// T-030tg: composition root worker untuk pesan kanal masuk (SOLID-D). Merakit adapter
// konkret → InboundDeps (use case core). Terpisah dari composition.ts (publish) agar
// worker publish tetap bisa jalan tanpa kredensial Telegram/LLM.
//
// Wiring agent loop di sini SEJAJAR dengan yang ada di apps/api (web chat): tiap app
// adalah composition root-nya sendiri (AGENTS.md §2), dan tool/use case yang dirakit
// semuanya hidup di core — jadi yang "berulang" hanyalah perakitannya, bukan logikanya.

import {
  ConversationRepositoryPrisma,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  OpenAiCompatibleAgentAdapter,
  RevisionRepositoryPrisma,
  SitebuilderToolAdapter,
  TelegramChannel,
  WebsiteRepositoryPrisma,
  createDeepSeekJsonAdapter,
  createGlmJsonAdapter,
  createPrismaClient,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MessageDelegate,
  type RevisionDelegate,
  type WebsiteDelegate,
} from '@digimaestro/adapters';
import {
  createAgentReplier,
  createAgentToolRegistry,
  createSitebuilderApplyPatchTool,
  createSitebuilderBuildSiteTool,
  createSitebuilderGetSiteOutlineTool,
  type BuildDeps,
  type ConversationReplier,
  type InboundDeps,
} from '@digimaestro/core';
import { siteDocumentSchema } from '@digimaestro/sites-kit';
import type { ChannelPort, ConversationRepository, LlmJsonPort } from '@digimaestro/shared';

export interface ChatWorkerEnv {
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly DIGIMAESTRO_LLM_PROVIDER?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_MODEL?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  readonly GLM_API_KEY?: string;
  readonly GLM_MODEL?: string;
  readonly GLM_BASE_URL?: string;
}

// Token bot = kredensial (siapa pun yang memegangnya bisa menyamar jadi bot ini) → hanya
// dari env, tak pernah masuk kode/log.
export function createTelegramChannel(env: ChatWorkerEnv = process.env): ChannelPort {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN wajib diisi untuk mengirim balasan Telegram');
  }
  return new TelegramChannel({ botToken, fetch: globalThis.fetch as never });
}

function createLlmJsonPort(
  env: ChatWorkerEnv,
  prisma: ReturnType<typeof createPrismaClient>,
): LlmJsonPort {
  const usageLogger = new LlmUsageLoggerPrisma(prisma.llmUsage as unknown as LlmUsageDelegate);
  const isGlm = env.DIGIMAESTRO_LLM_PROVIDER === 'glm';

  return isGlm
    ? createGlmJsonAdapter({
        model: env.GLM_MODEL ?? 'glm-4.5',
        apiKey: env.GLM_API_KEY ?? '',
        baseUrl: env.GLM_BASE_URL,
        usageLogger,
      })
    : createDeepSeekJsonAdapter({
        model: env.DEEPSEEK_MODEL ?? 'deepseek-chat',
        apiKey: env.DEEPSEEK_API_KEY ?? '',
        baseUrl: env.DEEPSEEK_BASE_URL,
        usageLogger,
      });
}

// Agent produksi: LLM HTTP nyata + tool sitebuilder (outline/patch/build). Sama dengan
// yang dipakai web chat di apps/api → jawaban bot Telegram identik dengan chat web.
export function createChatReplier(
  conversations: ConversationRepository,
  prisma: ReturnType<typeof createPrismaClient>,
  env: ChatWorkerEnv = process.env,
): ConversationReplier {
  const isGlm = env.DIGIMAESTRO_LLM_PROVIDER === 'glm';
  const agentLlm = new OpenAiCompatibleAgentAdapter({
    provider: isGlm ? 'glm' : 'deepseek',
    model: isGlm ? (env.GLM_MODEL ?? 'glm-4.5') : (env.DEEPSEEK_MODEL ?? 'deepseek-chat'),
    apiKey: isGlm ? (env.GLM_API_KEY ?? '') : (env.DEEPSEEK_API_KEY ?? ''),
    baseUrl: isGlm
      ? (env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4')
      : (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'),
  });

  const websites = new WebsiteRepositoryPrisma(prisma.website as unknown as WebsiteDelegate);
  const revisions = new RevisionRepositoryPrisma(prisma as unknown as RevisionDelegate);
  const jsonLlm = createLlmJsonPort(env, prisma);

  const sitebuilder = new SitebuilderToolAdapter({
    websites,
    revisions,
    llm: jsonLlm,
    siteDocSchema: siteDocumentSchema,
  });
  const buildDeps: BuildDeps = {
    llm: jsonLlm,
    revisions,
    websites,
    siteDocSchema: siteDocumentSchema,
  };

  return createAgentReplier({
    router: { conversations },
    loop: {
      llm: agentLlm,
      tools: createAgentToolRegistry([
        createSitebuilderGetSiteOutlineTool(sitebuilder),
        createSitebuilderApplyPatchTool(sitebuilder),
        createSitebuilderBuildSiteTool(buildDeps),
      ]),
    },
  });
}

export function createInboundDeps(env: ChatWorkerEnv = process.env): InboundDeps {
  const prisma = createPrismaClient();
  const conversations = new ConversationRepositoryPrisma(
    prisma.conversation as unknown as ConversationDelegate,
  );
  const messages = new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate);

  return {
    conversations,
    messages,
    channel: createTelegramChannel(env),
    reply: createChatReplier(conversations, prisma, env),
  };
}
