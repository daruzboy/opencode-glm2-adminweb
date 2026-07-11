// T-030tg: composition root worker untuk pesan kanal masuk (SOLID-D). Merakit adapter
// konkret → InboundDeps (use case core). Terpisah dari composition.ts (publish) agar
// worker publish tetap bisa jalan tanpa kredensial Telegram/LLM.
//
// Wiring agent loop di sini SEJAJAR dengan yang ada di apps/api (web chat): tiap app
// adalah composition root-nya sendiri (AGENTS.md §2), dan tool/use case yang dirakit
// semuanya hidup di core — jadi yang "berulang" hanyalah perakitannya, bukan logikanya.

import {
  ConversationRepositoryPrisma,
  DEFAULT_RATE_LIMIT,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  OpenAiCompatibleAgentAdapter,
  PublishSourcePrisma,
  RateLimitedChannel,
  RevisionRepositoryPrisma,
  SitebuilderToolAdapter,
  TelegramChannel,
  WebsiteRepositoryPrisma,
  createBullMqPublishQueue,
  createDeepSeekJsonAdapter,
  createGlmJsonAdapter,
  createPreviewToken,
  createPrismaClient,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MessageDelegate,
  type PublishSourceDelegate,
  type RevisionDelegate,
  type WebsiteDelegate,
} from '@digimaestro/adapters';
import {
  createAgentReplier,
  createAgentToolRegistry,
  createSitebuilderApplyPatchTool,
  createSitebuilderBuildSiteTool,
  createSitebuilderGetSiteOutlineTool,
  notifyPublishOutcome,
  type ApprovalDeps,
  type BuildDeps,
  type ConversationReplier,
  type InboundDeps,
  type NotifyDeps,
} from '@digimaestro/core';
import { siteDocumentSchema } from '@digimaestro/sites-kit';
import { tenantId } from '@digimaestro/shared';
import type { ChannelPort, ConversationRepository, LlmJsonPort } from '@digimaestro/shared';
import type { PublishNotifier } from './publish-worker.js';

export interface ChatWorkerEnv {
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly REDIS_URL?: string;
  readonly PREVIEW_TOKEN_SECRET?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLISH_BASE_DOMAIN?: string;
  readonly CHANNEL_RATE_LIMIT?: string;
  readonly CHANNEL_RATE_WINDOW_MS?: string;
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

// T-031tg: approval lewat chat (tombol "Setuju & publish" → antrean publish, BRU-02).
// Aktif hanya bila REDIS_URL ada (produsen antrean). previewUrl butuh PREVIEW_TOKEN_SECRET
// + PUBLIC_API_URL; tanpa itu pesan tetap dikirim, hanya tanpa tautan preview.
export function createApprovalDeps(env: ChatWorkerEnv = process.env): ApprovalDeps | undefined {
  if (!env.REDIS_URL) return undefined;

  const prisma = createPrismaClient();
  const websites = new WebsiteRepositoryPrisma(prisma.website as unknown as WebsiteDelegate);
  const revisions = new RevisionRepositoryPrisma(prisma as unknown as RevisionDelegate);
  const source = new PublishSourcePrisma({
    website: prisma.website as unknown as PublishSourceDelegate['website'],
    revision: prisma.revision as unknown as PublishSourceDelegate['revision'],
  });

  const url = new URL(env.REDIS_URL);
  const queue = createBullMqPublishQueue({
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  });

  const secret = env.PREVIEW_TOKEN_SECRET;
  const apiUrl = env.PUBLIC_API_URL;
  const previewUrl =
    secret && apiUrl
      ? (revisionId: string) =>
          `${apiUrl.replace(/\/$/, '')}/api/preview/${revisionId}?t=${createPreviewToken(secret, revisionId)}`
      : undefined;

  return {
    websites,
    revisions,
    publish: {
      source,
      queue,
      rootDomain: env.PUBLISH_BASE_DOMAIN ?? 'digimaestro.id',
    },
    ...(previewUrl ? { previewUrl } : {}),
  };
}

// T-032tg: pengabar hasil publish → chat. Dipakai worker publish (bukan chat-inbound):
// job publish selesai/dead-letter → pengguna dikabari di percakapan Telegram-nya.
// Tanpa TELEGRAM_BOT_TOKEN → undefined (publish tetap jalan, hanya senyap).
export function createPublishNotifier(env: ChatWorkerEnv = process.env): PublishNotifier | undefined {
  if (!env.TELEGRAM_BOT_TOKEN) return undefined;

  const prisma = createPrismaClient();
  const deps: NotifyDeps = {
    conversations: new ConversationRepositoryPrisma(
      prisma.conversation as unknown as ConversationDelegate,
    ),
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
    // Rate limit ikut berlaku: notifikasi tetap pesan keluar ke pengguna.
    channel: rateLimited(createTelegramChannel(env), env),
  };

  return {
    async publishSucceeded(tid: string, url: string): Promise<void> {
      await notifyPublishOutcome(deps, { tenantId: tenantId(tid), notice: { kind: 'live', url } });
    },
    async publishFailed(tid: string, reason: string): Promise<void> {
      await notifyPublishOutcome(deps, {
        tenantId: tenantId(tid),
        notice: { kind: 'failed', reason },
      });
    },
  };
}

// Rate limit di tepi keluar (T-031tg) — dipakai baik oleh balasan chat maupun notifikasi.
function rateLimited(inner: ChannelPort, env: ChatWorkerEnv): ChannelPort {
  return new RateLimitedChannel(inner, {
    limit: Number(env.CHANNEL_RATE_LIMIT ?? DEFAULT_RATE_LIMIT.limit),
    windowMs: Number(env.CHANNEL_RATE_WINDOW_MS ?? DEFAULT_RATE_LIMIT.windowMs),
  });
}

export function createInboundDeps(env: ChatWorkerEnv = process.env): InboundDeps {
  const prisma = createPrismaClient();
  const conversations = new ConversationRepositoryPrisma(
    prisma.conversation as unknown as ConversationDelegate,
  );
  const messages = new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate);
  const approval = createApprovalDeps(env);

  return {
    conversations,
    messages,
    // Rate limit di TEPI KELUAR (T-031tg): menahan banjir pesan (bug/loop agent) dan
    // menghindari 429 Telegram. Membungkus kanal → berlaku untuk teks maupun tombol.
    channel: rateLimited(createTelegramChannel(env), env),
    reply: createChatReplier(conversations, prisma, env),
    ...(approval ? { approval } : {}),
  };
}
