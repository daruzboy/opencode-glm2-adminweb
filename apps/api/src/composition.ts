import {
  ConversationRepositoryPrisma,
  JwtAuthPort,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  OpenAiCompatibleAgentAdapter,
  RevisionRepositoryPrisma,
  SitebuilderToolAdapter,
  WebsiteRepositoryPrisma,
  createDeepSeekJsonAdapter,
  createDeterministicLlmAgentAdapter,
  createGlmJsonAdapter,
  createPrismaClient,
  createBullMqPublishQueue,
  PreviewPortPrisma,
  PublishSourcePrisma,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MessageDelegate,
  type PublishSourceDelegate,
  type RevisionDelegate,
  type RevisionPreviewDelegate,
  type RuntimeFetch,
  type WebsiteDelegate,
} from '@digimaestro/adapters';
import {
  createAgentReplier,
  createAgentToolRegistry,
  createSitebuilderApplyPatchTool,
  createSitebuilderGetSiteOutlineTool,
  type ConversationReplier,
  type SitebuilderToolPort,
} from '@digimaestro/core';
import type { AuthPort, ConversationRepository, LlmAgentResponse, LlmJsonPort, LlmUsageLoggerPort } from '@digimaestro/shared';
import type { ChatDeps } from './chat/handle-incoming.js';
import type { PreviewDeps } from './preview/handle-preview.js';
import type { PublishRequestDeps } from './publish/handle-publish.js';

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

  // T-053c: bila API key tersedia → gunakan adapter HTTP produksi (DeepSeek/GLM).
  // Bila tidak → fallback deterministik (dev tanpa key).
  const apiKey = env.DIGIMAESTRO_LLM_PROVIDER === 'glm' ? env.GLM_API_KEY : env.DEEPSEEK_API_KEY;
  if (apiKey && apiKey.length > 0) {
    const reply = createProductionAgentReplier(conversations, prisma, env);
    return { conversations, messages, reply };
  }

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

export interface CreatePublishRequestDepsOptions {
  readonly prisma?: { website: PublishSourceDelegate['website']; revision: PublishSourceDelegate['revision'] };
  readonly redisUrl?: string;
  readonly rootDomain?: string;
}

// Composition publish request (T-063, BRU-02): sumber Prisma tenant-scoped + produsen antrean
// BullMQ. rootDomain dari PUBLISH_BASE_DOMAIN (default digimaestro.id). Butuh DATABASE_URL +
// REDIS_URL saat nyata; test menyuntik fake sehingga rute teruji tanpa DB/Redis.
export function createPublishRequestDeps(options: CreatePublishRequestDepsOptions = {}): PublishRequestDeps {
  const prisma = options.prisma ?? createPrismaClient();
  const source = new PublishSourcePrisma({
    website: prisma.website as unknown as PublishSourceDelegate['website'],
    revision: prisma.revision as unknown as PublishSourceDelegate['revision'],
  });
  const url = new URL(options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379');
  const queue = createBullMqPublishQueue({
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    // maxRetriesPerRequest null wajib utk koneksi BullMQ.
    maxRetriesPerRequest: null,
  });
  const rootDomain = options.rootDomain ?? process.env.PUBLISH_BASE_DOMAIN ?? 'digimaestro.id';
  return { source, queue, rootDomain };
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

// T-053c: Replier produksi dengan adapter HTTP nyata (DeepSeek/GLM). Dipakai bila
// API key tersedia. Error adapter → fallback stubReply di handle-incoming (chat tak mati).
// Registry tool sitebuilder untuk agent produksi (T-053d): daftarkan
// `sitebuilder_get_site_outline` + `sitebuilder_apply_patch` (T-051) di atas
// `SitebuilderToolPort` (adapter T-053b). Diekspor + bergantung port → teruji offline
// dgn fake port (tanpa Prisma/jaringan).
export function createSitebuilderToolRegistry(
  port: SitebuilderToolPort,
): ReturnType<typeof createAgentToolRegistry> {
  return createAgentToolRegistry([
    createSitebuilderGetSiteOutlineTool(port),
    createSitebuilderApplyPatchTool(port),
  ]);
}

// Agent produksi: LLM HTTP nyata (T-053c) + tool sitebuilder (T-053d) yang menyambungkan
// loop percakapan ke build/edit Site Document (adapter T-053b di atas repo T-020ext). Tool
// LLM revision_patch = `createLlmJsonPort` (JSON satu-tembakan); repo dari prisma yg sama
// (ter-guard tenant T-021).
function createProductionAgentReplier(
  conversations: ConversationRepository,
  prisma: ReturnType<typeof createPrismaClient>,
  env: LlmEnv,
): ConversationReplier {
  const isGlm = env.DIGIMAESTRO_LLM_PROVIDER === 'glm';
  const apiKey = isGlm ? (env.GLM_API_KEY ?? '') : (env.DEEPSEEK_API_KEY ?? '');
  const model = isGlm ? (env.GLM_MODEL ?? 'glm-4.5') : (env.DEEPSEEK_MODEL ?? 'deepseek-chat');
  const baseUrl = isGlm
    ? (env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4')
    : (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1');

  const agentLlm = new OpenAiCompatibleAgentAdapter({
    provider: isGlm ? 'glm' : 'deepseek',
    model,
    apiKey,
    baseUrl,
  });

  const websites = new WebsiteRepositoryPrisma(prisma.website as unknown as WebsiteDelegate);
  const revisions = new RevisionRepositoryPrisma(prisma as unknown as RevisionDelegate);
  const sitebuilder = new SitebuilderToolAdapter({
    websites,
    revisions,
    llm: createLlmJsonPort({ env }),
  });

  return createAgentReplier({
    router: { conversations },
    loop: {
      llm: agentLlm,
      tools: createSitebuilderToolRegistry(sitebuilder),
    },
  });
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

// ── Auth (T-002auth) ──────────────────────────────────────────────────────────

export interface AuthDeps {
  readonly auth: AuthPort;
  readonly allowHeaderFallback: boolean;
}

export function createAuthDeps(env: NodeJS.ProcessEnv = process.env): AuthDeps | undefined {
  const secret = env.JWT_SECRET;
  if (!secret) return undefined;
  return {
    auth: new JwtAuthPort({ secret }),
    allowHeaderFallback: env.AUTH_DISABLED === '1',
  };
}
