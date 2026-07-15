import {
  ConversationRepositoryPrisma,
  createFileSopProvider,
  JwtAuthPort,
  LlmUsageLoggerPrisma,
  LlmUsageQueryPrisma,
  MediaRepositoryPrisma,
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
  createBullMqChatInboundQueue,
  createBullMqRedisClient,
  createPreviewToken,
  indexTemplates,
  EditorWebHandoff,
  TelegramChannel,
  type TemplateDelegate,
  PreviewPortPrisma,
  PublishSourcePrisma,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type RawQueryClient,
  type MediaDelegate,
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
  createSitebuilderBuildSiteTool,
  createSitebuilderGetSiteOutlineTool,
  type BuildDeps,
  type ConversationReplier,
  type PublishRequestDeps,
  type SitebuilderToolPort,
} from '@digimaestro/core';
import {
  SECTION_REGISTRY,
  THEME_IDS,
  assembleSiteDocument,
  parseMobiriseProject,
  siteDraftJsonSchema,
  siteDocumentSchema,
  siteDraftSchema,
} from '@digimaestro/sites-kit';
import {
  BUILD_LLM_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_MODEL,
  parsePublishUrlMode,
  parseTokenPrice,
  tenantId as asTenantId,
} from '@digimaestro/shared';
import type { EditorHandoffPort, LlmTokenPrice } from '@digimaestro/shared';
import type { ReviewCompleteDeps } from '@digimaestro/core';
import type { ReadinessDeps } from './readiness.js';
import type { TemplateAdminDeps } from './admin/template-routes.js';
import type { ReviewRoutesDeps } from './review/routes.js';
import type {
  AgentToolDefinition,
  AuthPort,
  ConversationRepository,
  LlmAgentResponse,
  LlmJsonPort,
  LlmUsageLoggerPort,
} from '@digimaestro/shared';
import type { UsageRoutesDeps } from './admin/usage-routes.js';
import type { TelegramWebhookDeps } from './channel/telegram-webhook.js';
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
  readonly LLM_PRICE_INPUT_PER_1M?: string;
  readonly LLM_PRICE_OUTPUT_PER_1M?: string;
  // SOP layanan PO (file markdown; dibaca ulang saat berubah).
  readonly SOP_PATH?: string;
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
  // URL yang DIJANJIKAN ke pengguna harus sama dengan yang nanti diverifikasi worker.
  const urlMode = parsePublishUrlMode(process.env.PUBLISH_URL_MODE);
  return { source, queue, rootDomain, urlMode };
}

// T-082: laporan biaya AI. Query LINTAS-tenant (laporan admin) → sengaja memakai klien
// TANPA tenantGuard; pagar aksesnya di rute (role OWNER + ADMIN_TENANT_ID).
export function createUsageRoutesDeps(env: NodeJS.ProcessEnv = process.env): UsageRoutesDeps {
  const prisma = createPrismaClient();
  return {
    usage: new LlmUsageQueryPrisma(prisma as unknown as RawQueryClient),
    price: parseTokenPrice(env.LLM_PRICE_INPUT_PER_1M, env.LLM_PRICE_OUTPUT_PER_1M),
    ...(env.ADMIN_TENANT_ID ? { adminTenantId: env.ADMIN_TENANT_ID } : {}),
  };
}

export interface CreateTelegramWebhookDepsOptions {
  readonly redisUrl?: string;
  readonly secretToken?: string;
  readonly allowlistRaw?: string;
}

// Composition webhook Telegram (T-030tg): produsen antrean BullMQ `chat-inbound`.
// TELEGRAM_WEBHOOK_SECRET wajib — endpoint webhook publik, dan header secret token adalah
// satu-satunya bukti bahwa pemanggilnya benar Telegram. Menolak start lebih baik daripada
// diam-diam menjalankan webhook yang bisa disuntik siapa saja.
export function createTelegramWebhookDeps(
  options: CreateTelegramWebhookDepsOptions = {},
): TelegramWebhookDeps {
  const secretToken = options.secretToken ?? process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretToken) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET wajib diisi untuk mengaktifkan webhook Telegram');
  }
  const url = new URL(options.redisUrl ?? process.env.REDIS_URL ?? 'redis://localhost:6379');
  const queue = createBullMqChatInboundQueue({
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  });
  return {
    queue,
    secretToken,
    allowlistRaw: options.allowlistRaw ?? process.env.TELEGRAM_ALLOWLIST,
  };
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
// Registry tool sitebuilder untuk agent produksi (T-053d/T-053e): daftarkan
// `sitebuilder_get_site_outline` + `sitebuilder_apply_patch` (T-051) di atas
// `SitebuilderToolPort` (adapter T-053b) + `extraTools` (mis. `sitebuilder_build_site`,
// T-053e). Diekspor + bergantung port → teruji offline dgn fake port (tanpa Prisma/jaringan).
export function createSitebuilderToolRegistry(
  port: SitebuilderToolPort,
  extraTools: readonly AgentToolDefinition<unknown, unknown>[] = [],
): ReturnType<typeof createAgentToolRegistry> {
  return createAgentToolRegistry([
    createSitebuilderGetSiteOutlineTool(port),
    createSitebuilderApplyPatchTool(port),
    ...extraTools,
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
  const model = isGlm ? (env.GLM_MODEL ?? 'glm-4.5') : (env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL);
  const baseUrl = isGlm
    ? (env.GLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4')
    : (env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1');

  // T-082 (BUG): agent adapter TIDAK PERNAH disuntik usageLogger → seluruh percakapan chat
  // (mayoritas pemakaian!) tak tercatat di LlmUsage. Terbukti di produksi: hanya task
  // `site_plan` yang punya baris; chat/interview NOL.
  const agentLlm = new OpenAiCompatibleAgentAdapter({
    usageLogger: new LlmUsageLoggerPrisma(prisma.llmUsage as unknown as LlmUsageDelegate),
    price: tokenPrice(env),
    provider: isGlm ? 'glm' : 'deepseek',
    model,
    apiKey,
    baseUrl,
  });

  const websites = new WebsiteRepositoryPrisma(prisma.website as unknown as WebsiteDelegate);
  const revisions = new RevisionRepositoryPrisma(prisma as unknown as RevisionDelegate);
  const jsonLlm = createLlmJsonPort({ env });

  // T-053e: schema Site Document NYATA (sites-kit) → applyPatch & build memvalidasi output
  // LLM + self-repair (bukan lagi PERMISSIVE). Zod safeParse kompatibel struktural LlmJsonSchema.
  const sitebuilder = new SitebuilderToolAdapter({
    websites,
    revisions,
    llm: jsonLlm,
    siteDocSchema: siteDocumentSchema,
  });

  // T-053e: tool build situs baru dari brief (buildSiteFromBrief) → menutup jalur situs baru.
  const mediaRepo = new MediaRepositoryPrisma(prisma.mediaAsset as unknown as MediaDelegate);
  const buildDeps: BuildDeps = {
    llm: jsonLlm,
    revisions,
    websites,
    siteDocSchema: siteDraftSchema,
    assembleDoc: assembleSiteDocument,
    catalog: {
      themeIds: THEME_IDS,
      sections: sectionCatalog(),
      draftJsonSchema: siteDraftJsonSchema(),
    },
    // T-033: galeri memakai foto NYATA pelanggan (bukan URL karangan LLM).
    mediaUrls: async (tid) => {
      const all = await mediaRepo.findMany(tid);
      return all.ok ? all.value.map((m) => m.url) : [];
    },
  };
  const buildTool = createSitebuilderBuildSiteTool(buildDeps);

  return createAgentReplier({
    router: { conversations },
    // T-053f: riwayat percakapan → agent ingat konteks (tanpa ini: amnesia tiap pesan).
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
    // SOP layanan PO — dokumen sunting-sendiri, sama dgn worker Telegram.
    ...(env.SOP_PATH ? { sop: createFileSopProvider({ path: env.SOP_PATH, logger: console }) } : {}),
    loop: {
      llm: agentLlm,
      tools: createSitebuilderToolRegistry(sitebuilder, [buildTool]),
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
      // Tanpa price, cost tercatat $0 padahal token terbakar (T-082).
      price: tokenPrice(env),
      timeoutMs: BUILD_LLM_TIMEOUT_MS,
    });
  }

  return createDeepSeekJsonAdapter({
    model: env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
    apiKey: env.DEEPSEEK_API_KEY ?? '',
    baseUrl: env.DEEPSEEK_BASE_URL,
    fetch: options.fetch,
    usageLogger,
    price: tokenPrice(env),
    timeoutMs: BUILD_LLM_TIMEOUT_MS,
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
  // Endpoint dev /api/auth/token (cetak token dari slug, TANPA kredensial) — hanya bila
  // AUTH_DEV_TOKEN=1. Produksi biarkan kosong agar endpoint tak terpasang (keamanan #45).
  readonly devTokenEnabled: boolean;
}

export function createAuthDeps(env: NodeJS.ProcessEnv = process.env): AuthDeps | undefined {
  const secret = env.JWT_SECRET;
  if (!secret) return undefined;
  return {
    auth: new JwtAuthPort({ secret }),
    allowHeaderFallback: env.AUTH_DISABLED === '1',
    devTokenEnabled: env.AUTH_DEV_TOKEN === '1',
  };
}

// type → varian sah (dari registry sites-kit) untuk disisipkan ke prompt build.
function sectionCatalog(): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(SECTION_REGISTRY).map(([type, def]) => [type, def.variants]),
  );
}

// T-082: harga token dari env (satu sumber kebenaran). 0 = belum dikonfigurasi → laporan
// biaya menampilkannya sebagai "belum diisi", bukan diam-diam melaporkan $0 sebagai fakta.
function tokenPrice(env: { LLM_PRICE_INPUT_PER_1M?: string; LLM_PRICE_OUTPUT_PER_1M?: string }): LlmTokenPrice {
  return parseTokenPrice(env.LLM_PRICE_INPUT_PER_1M, env.LLM_PRICE_OUTPUT_PER_1M);
}

// P3: deps admin reindex template. Butuh TEMPLATES_DIR (folder) + DATABASE_URL (registry)
// + ADMIN_TENANT_ID (pagar akses) — kurang satu pun → rute tak dipasang (fail-closed).
export function createTemplateAdminDeps(
  env: NodeJS.ProcessEnv = process.env,
): TemplateAdminDeps | undefined {
  if (!env.TEMPLATES_DIR || !env.DATABASE_URL || !env.ADMIN_TENANT_ID) return undefined;
  const templatesDir = env.TEMPLATES_DIR;
  const prisma = createPrismaClient() as unknown as { template: TemplateDelegate };
  return {
    adminTenantId: env.ADMIN_TENANT_ID,
    reindex: () => indexTemplates({ templatesDir, delegate: prisma.template }),
  };
}

// P1: probe kesiapan untuk /readyz. DB = SELECT 1 (lolos tenant-guard: raw tanpa model);
// Redis = SET kunci probe ber-TTL singkat (RedisRateCommands tak punya ping; SET PX 1000
// terhapus sendiri). Dependensi yang tak dikonfigurasi dilewati — bukan "tak siap".
export function createReadinessDeps(env: NodeJS.ProcessEnv = process.env): ReadinessDeps {
  const deps: { db?: () => Promise<void>; redis?: () => Promise<void> } = {};

  if (env.DATABASE_URL) {
    const prisma = createPrismaClient() as unknown as {
      $queryRawUnsafe(query: string): Promise<unknown>;
    };
    deps.db = async () => {
      await prisma.$queryRawUnsafe('SELECT 1');
    };
  }

  if (env.REDIS_URL) {
    const url = new URL(env.REDIS_URL);
    const client = createBullMqRedisClient({
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    });
    deps.redis = async () => {
      await (await client()).set('readyz:probe', '1', 'PX', 1_000, 'NX');
    };
  }

  return deps;
}

// ── P5: gerbang review PO ──────────────────────────────────────────────────────
// Callback "Kirim ke pelanggan" dari editor-web + re-trigger handoff (admin).
// Butuh REVIEW_CALLBACK_TOKEN + TELEGRAM_BOT_TOKEN + DATABASE_URL; kurang satu →
// rute tak dipasang (fail-closed).
export function createReviewRoutesDeps(
  env: NodeJS.ProcessEnv = process.env,
): ReviewRoutesDeps | undefined {
  if (!env.REVIEW_CALLBACK_TOKEN || !env.TELEGRAM_BOT_TOKEN || !env.DATABASE_URL) {
    return undefined;
  }

  const prisma = createPrismaClient();
  const revisions = new RevisionRepositoryPrisma(prisma as unknown as RevisionDelegate);
  const websites = new WebsiteRepositoryPrisma(prisma.website as unknown as WebsiteDelegate);
  const channel = new TelegramChannel({
    botToken: env.TELEGRAM_BOT_TOKEN,
    fetch: globalThis.fetch as never,
  });

  const secret = env.PREVIEW_TOKEN_SECRET;
  const apiUrl = env.PUBLIC_API_URL;
  const previewUrl =
    secret && apiUrl
      ? (revisionId: string) =>
          `${apiUrl.replace(/\/$/, '')}/api/preview/${revisionId}?t=${createPreviewToken(secret, revisionId)}`
      : undefined;

  const review: ReviewCompleteDeps = {
    revisions,
    websites,
    conversations: new ConversationRepositoryPrisma(
      prisma.conversation as unknown as ConversationDelegate,
    ),
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
    channel,
    // Validasi dokumen editan — skema BERSAMA dgn editor-web (sites-kit).
    parseDocument: (value) => {
      const parsed = parseMobiriseProject(value);
      return parsed.ok ? { ok: true } : { ok: false, message: parsed.message };
    },
    ...(previewUrl ? { previewUrl } : {}),
    logger: console,
  };

  // tenantId pemilik website — dari DB TEPERCAYA (bukan body callback). Raw query lolos
  // tenant-guard (guard hanya mencegat operasi ber-model).
  const tenantOfWebsite = async (websiteId: string): Promise<string | null> => {
    const rows = await (prisma as unknown as {
      $queryRawUnsafe<T>(q: string, ...v: unknown[]): Promise<T>;
    }).$queryRawUnsafe<{ tenantId: string }[]>(
      'SELECT "tenantId" FROM "Website" WHERE "id" = $1',
      websiteId,
    );
    return rows[0]?.tenantId ?? null;
  };

  // Re-trigger handoff (pemulihan): baca ulang revisi PENDING → kirim ulang ke editor-web.
  const handoff = createEditorHandoff(env);
  const admin =
    env.ADMIN_TENANT_ID && handoff
      ? {
          adminTenantId: env.ADMIN_TENANT_ID,
          retrigger: async (revisionId: string): Promise<{ ok: boolean; message: string }> => {
            const rows = await (prisma as unknown as {
              $queryRawUnsafe<T>(q: string, ...v: unknown[]): Promise<T>;
            }).$queryRawUnsafe<
              { id: string; websiteId: string; siteDoc: unknown; templateId: string | null; status: string; tenantId: string; slug: string; name: string }[]
            >(
              `SELECT r."id", r."websiteId", r."siteDoc", r."templateId", r."status", w."tenantId", w."slug", t."name"
                 FROM "Revision" r
                 JOIN "Website" w ON w."id" = r."websiteId"
                 JOIN "Tenant" t ON t."id" = w."tenantId"
                WHERE r."id" = $1`,
              revisionId,
            );
            const row = rows[0];
            if (!row) return { ok: false, message: 'revisi tidak ditemukan' };
            if (row.status !== 'PENDING_ADMIN_REVIEW') {
              return { ok: false, message: `revisi berstatus ${row.status}, bukan menunggu review` };
            }
            const sent = await handoff.createProject({
              name: `AI · ${row.name} (${row.slug})`,
              templateId: row.templateId ?? 'tanpa-template',
              document: row.siteDoc,
              source: {
                websiteId: row.websiteId,
                revisionId: row.id,
                returnUrl: `${(env.PUBLIC_API_URL ?? '').replace(/\/$/, '')}/api/internal/review/complete`,
              },
            });
            if (!sent.ok) return { ok: false, message: sent.error.message };
            const upd = await revisions.update(
              asTenantId(row.tenantId),
              row.websiteId,
              row.id,
              { editorProjectId: sent.value.projectId },
            );
            return upd.ok
              ? { ok: true, message: `handoff ulang OK → ${sent.value.editorUrl}` }
              : { ok: false, message: `terkirim tapi korelasi gagal disimpan: ${upd.error.message}` };
          },
        }
      : undefined;

  return {
    serviceToken: env.REVIEW_CALLBACK_TOKEN,
    review,
    tenantOfWebsite,
    ...(admin ? { admin } : {}),
  };
}

// P5: adapter handoff ke editor-web (dipakai worker via build deps & re-trigger admin).
export function createEditorHandoff(
  env: NodeJS.ProcessEnv = process.env,
): EditorHandoffPort | undefined {
  if (!env.EDITOR_WEB_API_URL || !env.EDITOR_WEB_APP_URL || !env.HANDOFF_SERVICE_TOKEN) {
    return undefined;
  }
  return new EditorWebHandoff({
    apiBaseUrl: env.EDITOR_WEB_API_URL,
    appBaseUrl: env.EDITOR_WEB_APP_URL,
    serviceToken: env.HANDOFF_SERVICE_TOKEN,
    fetch: globalThis.fetch as never,
  });
}
