// T-030tg: composition root worker untuk pesan kanal masuk (SOLID-D). Merakit adapter
// konkret → InboundDeps (use case core). Terpisah dari composition.ts (publish) agar
// worker publish tetap bisa jalan tanpa kredensial Telegram/LLM.
//
// Wiring agent loop di sini SEJAJAR dengan yang ada di apps/api (web chat): tiap app
// adalah composition root-nya sendiri (AGENTS.md §2), dan tool/use case yang dirakit
// semuanya hidup di core — jadi yang "berulang" hanyalah perakitannya, bukan logikanya.

import {
  ChannelBindingPrisma,
  ConversationRepositoryPrisma,
  DEFAULT_INBOUND_LIMIT,
  DEFAULT_INBOUND_WINDOW_MS,
  DEFAULT_RATE_LIMIT,
  LlmUsageLoggerPrisma,
  MessageRepositoryPrisma,
  OpenAiCompatibleAgentAdapter,
  PublishSourcePrisma,
  RateLimitedChannel,
  EditorWebHandoff,
  RevisionRepositoryPrisma,
  SitebuilderToolAdapter,
  TelegramChannel,
  TemplateCatalogFs,
  type TemplateQueryDelegate,
  WebsiteRepositoryPrisma,
  createBullMqPublishQueue,
  createDeepSeekJsonAdapter,
  createGlmJsonAdapter,
  FtpsMediaStore,
  InviteCodePrisma,
  MediaRepositoryPrisma,
  MultiAlert,
  QuotaPrisma,
  TenantProvisionPrisma,
  type OnboardingClient,
  SharpMediaProcessor,
  TelegramAlert,
  ThrottledAlert,
  WebhookAlert,
  DEFAULT_ALERT_COOLDOWN_MS,
  TelegramMediaDownload,
  createBasicFtpDeployClient,
  ChainedImageSource,
  PexelsImageSource,
  UnsplashImageSource,
  createBullMqChatInboundQueue,
  createBullMqRedisClient,
  createFileSopProvider,
  createHttpImageDownload,
  createPreviewToken,
  createRedisInboundRateLimiter,
  createPrismaClient,
  mediaFilename,
  startTelegramPoller,
  type ConversationDelegate,
  type LlmUsageDelegate,
  type MediaDelegate,
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
  createTemplateBuildSiteTool,
  deriveSlug,
  ingestMedia,
  invalidCodeReply,
  needsCodeReply,
  notifyPublishOutcome,
  registerFromInvite,
  registeredReply,
  resolveSlotImages,
  type ResolveSlotImagesDeps,
  type ApprovalDeps,
  type BuildDeps,
  type ConversationReplier,
  type InboundDeps,
  type MediaDeps,
  type NotifyDeps,
} from '@digimaestro/core';
import {
  SECTION_REGISTRY,
  THEME_IDS,
  assembleSiteDocument,
  siteDraftJsonSchema,
  siteDocumentSchema,
  siteDraftSchema,
} from '@digimaestro/sites-kit';
import {
  BUILD_LLM_TIMEOUT_MS,
  DEFAULT_DEEPSEEK_MODEL,
  parsePublishUrlMode,
  tenantId,
} from '@digimaestro/shared';
import { parseTokenPrice } from '@digimaestro/shared';
import type {
  AlertPort,
  ImageSourcePort,
  InboundRateLimiterPort,
  LlmTokenPrice,
  PageFills,
  QuotaPort,
  TenantId,
} from '@digimaestro/shared';
import type { RegistrationHandler } from './chat-inbound-worker.js';
import type { ChannelPort, ConversationRepository, LlmJsonPort } from '@digimaestro/shared';
import type { PublishNotifier } from './publish-worker.js';
import type { PollerHandle } from '@digimaestro/adapters';

export interface ChatWorkerEnv {
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly REDIS_URL?: string;
  readonly DATABASE_URL?: string;
  readonly PREVIEW_TOKEN_SECRET?: string;
  readonly PUBLIC_API_URL?: string;
  readonly PUBLISH_BASE_DOMAIN?: string;
  readonly PUBLISH_URL_MODE?: string;
  readonly CHANNEL_RATE_LIMIT?: string;
  readonly CHANNEL_RATE_WINDOW_MS?: string;
  // P0: batas pesan MASUK per tenant (gerbang biaya LLM). Default 15/60 dtk.
  readonly INBOUND_RATE_LIMIT?: string;
  readonly INBOUND_RATE_WINDOW_MS?: string;
  readonly CPANEL_FTP_HOST?: string;
  readonly CPANEL_FTP_PORT?: string;
  readonly CPANEL_FTP_USER?: string;
  readonly CPANEL_FTP_PASSWORD?: string;
  readonly CPANEL_FTP_SECURE?: string;
  readonly CPANEL_FTP_REJECT_UNAUTHORIZED?: string;
  readonly TELEGRAM_MODE?: string;
  readonly TELEGRAM_ALLOWLIST?: string;
  // T-070: alert operasional ke PO.
  readonly ALERT_TELEGRAM_CHAT_ID?: string;
  readonly ALERT_WEBHOOK_URL?: string;
  readonly ALERT_COOLDOWN_MS?: string;
  readonly APP_ENV?: string;
  // Self-serve (#6). SELFSERVE_ENABLED=1 → chat tak dikenal boleh mendaftar dgn kode undangan.
  readonly SELFSERVE_ENABLED?: string;
  // P4: 'mobirise-v1' + TEMPLATES_DIR → build dari template Mobirise; selain itu legacy.
  readonly SITE_ENGINE?: string;
  readonly TEMPLATES_DIR?: string;
  // P6: gambar stok (download+rehost+atribusi). Tanpa key → slot gambar hanya foto
  // pelanggan / bawaan template (alur P4).
  readonly UNSPLASH_ACCESS_KEY?: string;
  readonly PEXELS_API_KEY?: string;
  // SOP layanan PO (file markdown di host, dibaca ulang saat berubah — tanpa restart).
  readonly SOP_PATH?: string;
  // P5: gerbang review PO (handoff ke editor-web).
  readonly REVIEW_GATE?: string;
  readonly EDITOR_WEB_API_URL?: string;
  readonly EDITOR_WEB_APP_URL?: string;
  readonly HANDOFF_SERVICE_TOKEN?: string;
  readonly TRIAL_QUOTA_MESSAGES?: string;
  readonly TRIAL_QUOTA_WEBSITES?: string;
  readonly TRIAL_DAYS?: string;
  readonly DIGIMAESTRO_LLM_PROVIDER?: string;
  readonly DEEPSEEK_API_KEY?: string;
  readonly DEEPSEEK_MODEL?: string;
  readonly DEEPSEEK_BASE_URL?: string;
  readonly GLM_API_KEY?: string;
  readonly GLM_MODEL?: string;
  readonly GLM_BASE_URL?: string;
  readonly LLM_PRICE_INPUT_PER_1M?: string;
  readonly LLM_PRICE_OUTPUT_PER_1M?: string;
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
        // Tanpa price, cost tercatat $0 padahal token terbakar (terbukti di produksi:
        // site_plan 3×4096 token out, cost 0.000000) — dashboard T-082 jadi bohong kecil.
        price: tokenPrice(env),
        timeoutMs: BUILD_LLM_TIMEOUT_MS,
      })
    : createDeepSeekJsonAdapter({
        model: env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
        apiKey: env.DEEPSEEK_API_KEY ?? '',
        baseUrl: env.DEEPSEEK_BASE_URL,
        usageLogger,
        price: tokenPrice(env),
        // Build situs = JSON besar & penalaran berat → 30 dtk default tak cukup (timeout
        // konsisten di uji nyata).
        timeoutMs: BUILD_LLM_TIMEOUT_MS,
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
  // T-082 (BUG): agent adapter TIDAK PERNAH disuntik usageLogger → seluruh percakapan chat
  // (mayoritas pemakaian!) tak tercatat di LlmUsage. Terbukti di produksi: hanya task
  // `site_plan` yang punya baris; chat/interview NOL.
  const agentLlm = new OpenAiCompatibleAgentAdapter({
    usageLogger: new LlmUsageLoggerPrisma(prisma.llmUsage as unknown as LlmUsageDelegate),
    price: tokenPrice(env),
    provider: isGlm ? 'glm' : 'deepseek',
    model: isGlm ? (env.GLM_MODEL ?? 'glm-4.5') : (env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL),
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
  // T-053g: LLM hanya mengarang DRAFT (title/themeId/pages); websiteId & design token
  // dirakit kode. Katalog tema/section disisipkan ke prompt agar model tak menebak nilai
  // yang akan ditolak schema.
  // T-033: foto pelanggan yang sudah masuk → disisipkan ke prompt build supaya galeri
  // memakai URL NYATA (tanpa ini LLM mengarang URL dan galeri jadi gambar rusak).
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
    mediaUrls: async (tid) => {
      const all = await mediaRepo.findMany(tid);
      return all.ok ? all.value.map((m) => m.url) : [];
    },
  };

  // P4: SITE_ENGINE=mobirise-v1 + TEMPLATES_DIR → build dari template Mobirise (AI memilih
  // template lalu mengisi slot). Default tetap legacy sections-v1 sampai QA lulus; cutover
  // = ganti env, situs lama tak terpengaruh (diskriminator per-Revision).
  const templateCatalog =
    env.SITE_ENGINE === 'mobirise-v1' && env.TEMPLATES_DIR
      ? new TemplateCatalogFs({
          templatesDir: env.TEMPLATES_DIR,
          delegate: prisma.template as unknown as TemplateQueryDelegate,
        })
      : undefined;
  // P5: gerbang review PO — aktif bila REVIEW_GATE=1 + kredensial editor-web lengkap.
  // Tanpa itu, build template langsung ke pelanggan (alur P4 murni).
  const handoff =
    env.REVIEW_GATE === '1' && env.EDITOR_WEB_API_URL && env.EDITOR_WEB_APP_URL && env.HANDOFF_SERVICE_TOKEN
      ? new EditorWebHandoff({
          apiBaseUrl: env.EDITOR_WEB_API_URL,
          appBaseUrl: env.EDITOR_WEB_APP_URL,
          serviceToken: env.HANDOFF_SERVICE_TOKEN,
          fetch: globalThis.fetch as never,
        })
      : undefined;

  // P6: resolver gambar stok — hanya bila API key + kredensial hosting ada.
  const resolveImages = createStockImageResolver(env, prisma);

  const buildToolBase = templateCatalog
    ? createTemplateBuildSiteTool({
        llm: jsonLlm,
        revisions,
        websites,
        catalog: templateCatalog,
        mediaUrls: buildDeps.mediaUrls as NonNullable<BuildDeps['mediaUrls']>,
        ...(resolveImages ? { resolveImages } : {}),
        ...(handoff ? { handoff } : {}),
        ...(handoff ? { alert: createAlert(env) } : {}),
        ...(env.PUBLIC_API_URL ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
      })
    : createSitebuilderBuildSiteTool(buildDeps);

  // UX (temuan uji nyata 2026-07-15): build makan 5–12 menit dan balasan chat baru keluar
  // SETELAH turn agent selesai → pelanggan menatap keheningan panjang ("chatbot belum
  // kirim balasan?"). Kabari SEBELUM build mulai — best-effort, tak menahan build.
  const buildTool = withBuildStartAck(buildToolBase, conversations, env);

  return createAgentReplier({
    router: { conversations },
    // T-053f: riwayat percakapan → agent ingat konteks (tanpa ini: amnesia tiap pesan).
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
    ...(env.SOP_PATH ? { sop: createFileSopProvider({ path: env.SOP_PATH, logger: console }) } : {}),
    loop: {
      llm: agentLlm,
      tools: createAgentToolRegistry([
        createSitebuilderGetSiteOutlineTool(sitebuilder),
        createSitebuilderApplyPatchTool(sitebuilder),
        buildTool,
      ]),
    },
  });
}

export const BUILD_START_ACK =
  '🛠️ Oke, websitenya mulai kubangun sekarang! Biasanya butuh 5–10 menit ya — nanti langsung kukabari di sini begitu ada perkembangan 🙏';

// Kirim kabar "mulai dibangun" ke chat Telegram tenant TEPAT sebelum build berjalan.
// Best-effort: kegagalan kirim tak boleh menggagalkan build; tanpa token bot → tool asli.
function withBuildStartAck(
  tool: ReturnType<typeof createSitebuilderBuildSiteTool>,
  conversations: ConversationRepository,
  env: ChatWorkerEnv,
): ReturnType<typeof createSitebuilderBuildSiteTool> {
  if (!env.TELEGRAM_BOT_TOKEN) return tool;
  const channel = rateLimited(createTelegramChannel(env), env);

  return {
    ...tool,
    async execute(input, ctx) {
      void (async () => {
        const found = await conversations.findMany(ctx.tenantId, { channel: 'TELEGRAM' });
        const ext = found.ok ? found.value.find((c) => c.externalId)?.externalId : null;
        if (ext) await channel.sendText(ext, BUILD_START_ACK);
      })().catch(() => undefined);
      return tool.execute(input, ctx);
    },
  };
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
      urlMode: parsePublishUrlMode(env.PUBLISH_URL_MODE),
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

// Rate limit di tepi keluar (T-031tg) — dipakai balasan chat maupun notifikasi publish.
// P1 (audit): bila REDIS_URL ada, state limiter dipindah ke Redis → batas tetap benar saat
// worker diskalakan >1 replika (memori proses akan jadi N×limit → 429 dari Telegram).
function rateLimited(inner: ChannelPort, env: ChatWorkerEnv): ChannelPort {
  const limit = Number(env.CHANNEL_RATE_LIMIT ?? DEFAULT_RATE_LIMIT.limit);
  const windowMs = Number(env.CHANNEL_RATE_WINDOW_MS ?? DEFAULT_RATE_LIMIT.windowMs);
  const shared = createOutboundRateLimiter(env, limit, windowMs);

  return new RateLimitedChannel(inner, {
    limit,
    windowMs,
    ...(shared ? { shared } : {}),
  });
}

function createOutboundRateLimiter(
  env: ChatWorkerEnv,
  limit: number,
  windowMs: number,
): InboundRateLimiterPort | undefined {
  if (!env.REDIS_URL) return undefined;
  const url = new URL(env.REDIS_URL);
  return createRedisInboundRateLimiter(
    {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    },
    { limit, windowMs, keyPrefix: 'out', logger: console },
  );
}

export function createInboundDeps(env: ChatWorkerEnv = process.env): InboundDeps {
  const prisma = createPrismaClient();
  const conversations = new ConversationRepositoryPrisma(
    prisma.conversation as unknown as ConversationDelegate,
  );
  const messages = new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate);
  const approval = createApprovalDeps(env);
  const media = createMediaDeps(env);
  const rateLimiter = createInboundRateLimiter(env);

  return {
    conversations,
    messages,
    // Rate limit di TEPI KELUAR (T-031tg): menahan banjir pesan (bug/loop agent) dan
    // menghindari 429 Telegram. Membungkus kanal → berlaku untuk teks maupun tombol.
    channel: rateLimited(createTelegramChannel(env), env),
    reply: createChatReplier(conversations, prisma, env),
    logger: console,
    ...(approval ? { approval } : {}),
    ...(media ? { media } : {}),
    ...(rateLimiter ? { rateLimiter } : {}),
    ...(createQuota(env) ? { quota: createQuota(env) } : {}),
  };
}

// P0 (audit): gerbang biaya pesan MASUK. State di Redis (bukan memori proses) → tetap benar
// saat worker diskalakan >1 replika. Tanpa REDIS_URL → undefined (bot tetap jalan, tanpa
// gerbang) — sama seperti kemampuan opsional lain.
export function createInboundRateLimiter(
  env: ChatWorkerEnv = process.env,
): InboundRateLimiterPort | undefined {
  if (!env.REDIS_URL) return undefined;

  const url = new URL(env.REDIS_URL);
  return createRedisInboundRateLimiter(
    {
      host: url.hostname,
      port: url.port ? Number(url.port) : 6379,
      username: url.username || undefined,
      password: url.password || undefined,
      maxRetriesPerRequest: null,
    },
    {
      limit: Number(env.INBOUND_RATE_LIMIT ?? DEFAULT_INBOUND_LIMIT),
      windowMs: Number(env.INBOUND_RATE_WINDOW_MS ?? DEFAULT_INBOUND_WINDOW_MS),
      logger: console,
    },
  );
}

// T-030tg-poll: poller long-polling. Dipakai saat TELEGRAM_MODE=polling (VPS tanpa domain
// publik → webhook tak bisa dipanggil Telegram). Update masuk ke antrean `chat-inbound`
// YANG SAMA dengan webhook → tak ada cabang pemrosesan kedua.
export function startPoller(
  env: ChatWorkerEnv = process.env,
  alert?: AlertPort,
): PollerHandle | undefined {
  if (env.TELEGRAM_MODE !== 'polling' || !env.TELEGRAM_BOT_TOKEN || !env.REDIS_URL) return undefined;

  const url = new URL(env.REDIS_URL);
  const queue = createBullMqChatInboundQueue({
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  });

  const resolver = createTenantResolver(env);

  return startTelegramPoller({
    botToken: env.TELEGRAM_BOT_TOKEN,
    queue,
    fetch: globalThis.fetch as never,
    ...(env.TELEGRAM_ALLOWLIST ? { allowlistRaw: env.TELEGRAM_ALLOWLIST } : {}),
    ...(alert ? { alert } : {}),
    ...(resolver ? { resolveTenant: resolver } : {}),
    allowRegistration: selfServeEnabled(env),
  });
}

// type → varian sah (dari registry sites-kit) untuk disisipkan ke prompt build.
function sectionCatalog(): Record<string, readonly string[]> {
  return Object.fromEntries(
    Object.entries(SECTION_REGISTRY).map(([type, def]) => [type, def.variants]),
  );
}

// T-033: terima foto pelanggan → unduh (Telegram) → optimasi (sharp: resize+WebP) →
// simpan ke hosting (FTPS) → catat MediaAsset. Aktif hanya bila kredensial hosting +
// token bot ada; tanpa itu foto ditolak sopan dan bot tetap jalan.
// Koneksi FTP baru tiap simpan: unggahan media jarang & singkat, sedangkan koneksi
// menganggur akan diputus server (Pure-FTPd: idle 15 menit). Dipakai ingest foto chat
// (T-033) dan rehost foto stok (P6).
function createFtpsStore(env: ChatWorkerEnv): FtpsMediaStore | undefined {
  if (!env.CPANEL_FTP_HOST || !env.CPANEL_FTP_USER) return undefined;
  return new FtpsMediaStore(
    () =>
      createBasicFtpDeployClient({
        host: env.CPANEL_FTP_HOST as string,
        port: env.CPANEL_FTP_PORT ? Number(env.CPANEL_FTP_PORT) : undefined,
        user: env.CPANEL_FTP_USER as string,
        password: env.CPANEL_FTP_PASSWORD ?? '',
        secure: env.CPANEL_FTP_SECURE ? env.CPANEL_FTP_SECURE !== 'false' : undefined,
        rejectUnauthorized: env.CPANEL_FTP_REJECT_UNAUTHORIZED
          ? env.CPANEL_FTP_REJECT_UNAUTHORIZED !== 'false'
          : undefined,
      }),
    { baseDomain: env.PUBLISH_BASE_DOMAIN ?? 'digimaestro.id' },
  );
}

// P6: resolver isian slot `stock` → foto stok Unsplash/Pexels di-rehost ke hosting.
// Butuh minimal satu API key + kredensial FTPS; tanpa itu → undefined (LLM tak akan
// ditawari opsi stock — fillSchema menolaknya).
function createStockImageResolver(
  env: ChatWorkerEnv,
  prisma: ReturnType<typeof createPrismaClient>,
): ((tid: TenantId, pages: readonly PageFills[]) => Promise<readonly PageFills[]>) | undefined {
  const store = createFtpsStore(env);
  if (!store) return undefined;

  const sources: ImageSourcePort[] = [];
  if (env.UNSPLASH_ACCESS_KEY) {
    sources.push(
      new UnsplashImageSource({ accessKey: env.UNSPLASH_ACCESS_KEY, fetch: globalThis.fetch as never }),
    );
  }
  if (env.PEXELS_API_KEY) {
    sources.push(new PexelsImageSource({ apiKey: env.PEXELS_API_KEY, fetch: globalThis.fetch as never }));
  }
  if (sources.length === 0) return undefined;

  const deps: ResolveSlotImagesDeps = {
    source: sources.length === 1 ? (sources[0] as ImageSourcePort) : new ChainedImageSource(sources),
    download: createHttpImageDownload({ fetch: globalThis.fetch as never }),
    processor: new SharpMediaProcessor(),
    store,
    media: new MediaRepositoryPrisma(prisma.mediaAsset as unknown as MediaDelegate),
    filename: mediaFilename,
    logger: console,
  };
  return (tid, pages) => resolveSlotImages(deps, tid, pages);
}

export function createMediaDeps(env: ChatWorkerEnv = process.env): MediaDeps | undefined {
  if (!env.TELEGRAM_BOT_TOKEN) return undefined;
  const store = createFtpsStore(env);
  if (!store) return undefined;

  const prisma = createPrismaClient();
  const media = new MediaRepositoryPrisma(prisma.mediaAsset as unknown as MediaDelegate);

  const deps = {
    download: new TelegramMediaDownload({
      botToken: env.TELEGRAM_BOT_TOKEN,
      fetch: globalThis.fetch as never,
    }),
    processor: new SharpMediaProcessor(),
    store,
    media,
    filename: mediaFilename,
  };

  return {
    async ingest(tenantId, mediaRef) {
      const res = await ingestMedia(deps, { tenantId, mediaRef });
      return res.ok ? { ok: true as const, value: { url: res.value.asset.url } } : res;
    },
    async count(tenantId) {
      const all = await media.findMany(tenantId);
      return all.ok ? all.value.length : 0;
    },
  };
}

// T-082: harga token dari env (satu sumber kebenaran). 0 = belum dikonfigurasi → laporan
// biaya menampilkannya sebagai "belum diisi", bukan diam-diam melaporkan $0 sebagai fakta.
function tokenPrice(env: { LLM_PRICE_INPUT_PER_1M?: string; LLM_PRICE_OUTPUT_PER_1M?: string }): LlmTokenPrice {
  return parseTokenPrice(env.LLM_PRICE_INPUT_PER_1M, env.LLM_PRICE_OUTPUT_PER_1M);
}

// T-070: alert operasional. Telegram = jalur UTAMA (hidup di luar infrastruktur kita, jadi
// tetap ada saat platform sekarat); webhook (n8n, ADR-7) = tambahan opsional. Diredam lewat
// Redis agar satu masalah tak jadi ratusan notifikasi (PO akan mematikan alert yang berisik,
// dan alert yang dimatikan = tidak ada alert).
export function createAlert(env: ChatWorkerEnv = process.env): AlertPort | undefined {
  const targets: AlertPort[] = [];

  if (env.ALERT_TELEGRAM_CHAT_ID && env.TELEGRAM_BOT_TOKEN) {
    targets.push(
      new TelegramAlert({
        opsChatId: env.ALERT_TELEGRAM_CHAT_ID,
        // Kanal MENTAH (tanpa rate limit pelanggan): alert tak boleh ikut tertahan kuota
        // kirim justru saat sistem sedang bermasalah.
        channel: createTelegramChannel(env),
        ...(env.APP_ENV ? { environment: env.APP_ENV } : {}),
      }),
    );
  }

  if (env.ALERT_WEBHOOK_URL) {
    targets.push(
      new WebhookAlert({
        url: env.ALERT_WEBHOOK_URL,
        fetch: globalThis.fetch as never,
        ...(env.APP_ENV ? { environment: env.APP_ENV } : {}),
      }),
    );
  }

  if (targets.length === 0) return undefined;
  const base = targets.length === 1 ? (targets[0] as AlertPort) : new MultiAlert(targets);

  if (!env.REDIS_URL) return base; // tanpa Redis: tetap alert (tanpa peredam)

  const url = new URL(env.REDIS_URL);
  const client = createBullMqRedisClient({
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null,
  });

  return new ThrottledAlert(base, client, {
    cooldownMs: Number(env.ALERT_COOLDOWN_MS ?? DEFAULT_ALERT_COOLDOWN_MS),
    logger: console,
  });
}

// ── Self-serve onboarding (#6) ───────────────────────────────────────────────
// Kuota trial: keputusan PO 2026-07-12 (100 pesan · 1 situs · 14 hari). Ini PAGAR BIAYA —
// tiap pesan memanggil LLM berbayar (~$0.0034 terukur).
export const TRIAL_DEFAULTS = { messages: 100, websites: 1, days: 14 } as const;

export function selfServeEnabled(env: ChatWorkerEnv = process.env): boolean {
  return env.SELFSERVE_ENABLED === '1';
}

// Resolusi tenant dari DB (ChannelBinding) — menggantikan allowlist env yang harus disunting
// manual tiap pelanggan baru.
export function createTenantResolver(
  env: ChatWorkerEnv = process.env,
): ((externalId: string) => Promise<string | null>) | undefined {
  if (!env.DATABASE_URL) return undefined;
  const prisma = createPrismaClient();
  const bindings = new ChannelBindingPrisma(prisma as unknown as OnboardingClient);

  return async (externalId: string) => {
    const r = await bindings.resolve('TELEGRAM', externalId);
    return r.ok ? r.value : null;
  };
}

export function createQuota(env: ChatWorkerEnv = process.env): QuotaPort | undefined {
  if (!env.DATABASE_URL) return undefined;
  const prisma = createPrismaClient();
  return new QuotaPrisma(prisma as unknown as OnboardingClient);
}

// Menangani chat yang BELUM dikenal: kode undangan → provision tenant. TANPA LLM.
export function createRegistrationHandler(
  env: ChatWorkerEnv = process.env,
): RegistrationHandler | undefined {
  if (!selfServeEnabled(env) || !env.DATABASE_URL || !env.TELEGRAM_BOT_TOKEN) return undefined;

  const prisma = createPrismaClient();
  const db = prisma as unknown as OnboardingClient;
  const channel = rateLimited(createTelegramChannel(env), env);

  const deps = {
    invites: new InviteCodePrisma(db),
    bindings: new ChannelBindingPrisma(db),
    tenants: new TenantProvisionPrisma(db),
    quotaMessages: Number(env.TRIAL_QUOTA_MESSAGES ?? TRIAL_DEFAULTS.messages),
    quotaWebsites: Number(env.TRIAL_QUOTA_WEBSITES ?? TRIAL_DEFAULTS.websites),
    trialDays: Number(env.TRIAL_DAYS ?? TRIAL_DEFAULTS.days),
    slugify: deriveSlug,
  };

  return {
    async handle(message) {
      const res = await registerFromInvite(deps, {
        channel: message.channel,
        externalId: message.externalId,
        text: message.text ?? '',
        ...(message.senderName ? { senderName: message.senderName } : {}),
      });

      if (!res.ok) {
        console.error(`[daftar] gagal: ${res.error.message}`);
        await channel.sendText(message.externalId, 'Maaf, pendaftaran lagi bermasalah. Coba lagi sebentar ya 🙏');
        return;
      }

      const teks =
        res.value.kind === 'registered'
          ? registeredReply(deps.quotaMessages, deps.trialDays)
          : res.value.kind === 'invalid_code'
            ? invalidCodeReply(res.value.reason)
            : needsCodeReply();

      await channel.sendText(message.externalId, teks);
    },
  };
}
