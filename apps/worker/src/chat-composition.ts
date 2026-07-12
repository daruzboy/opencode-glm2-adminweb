// T-030tg: composition root worker untuk pesan kanal masuk (SOLID-D). Merakit adapter
// konkret → InboundDeps (use case core). Terpisah dari composition.ts (publish) agar
// worker publish tetap bisa jalan tanpa kredensial Telegram/LLM.
//
// Wiring agent loop di sini SEJAJAR dengan yang ada di apps/api (web chat): tiap app
// adalah composition root-nya sendiri (AGENTS.md §2), dan tool/use case yang dirakit
// semuanya hidup di core — jadi yang "berulang" hanyalah perakitannya, bukan logikanya.

import {
  ConversationRepositoryPrisma,
  DEFAULT_INBOUND_LIMIT,
  DEFAULT_INBOUND_WINDOW_MS,
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
  FtpsMediaStore,
  MediaRepositoryPrisma,
  MultiAlert,
  SharpMediaProcessor,
  TelegramAlert,
  ThrottledAlert,
  WebhookAlert,
  DEFAULT_ALERT_COOLDOWN_MS,
  TelegramMediaDownload,
  createBasicFtpDeployClient,
  createBullMqChatInboundQueue,
  createBullMqRedisClient,
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
  ingestMedia,
  notifyPublishOutcome,
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
import type { AlertPort, InboundRateLimiterPort, LlmTokenPrice } from '@digimaestro/shared';
import type { ChannelPort, ConversationRepository, LlmJsonPort } from '@digimaestro/shared';
import type { PublishNotifier } from './publish-worker.js';
import type { PollerHandle } from '@digimaestro/adapters';

export interface ChatWorkerEnv {
  readonly TELEGRAM_BOT_TOKEN?: string;
  readonly REDIS_URL?: string;
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
        timeoutMs: BUILD_LLM_TIMEOUT_MS,
      })
    : createDeepSeekJsonAdapter({
        model: env.DEEPSEEK_MODEL ?? DEFAULT_DEEPSEEK_MODEL,
        apiKey: env.DEEPSEEK_API_KEY ?? '',
        baseUrl: env.DEEPSEEK_BASE_URL,
        usageLogger,
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

  return createAgentReplier({
    router: { conversations },
    // T-053f: riwayat percakapan → agent ingat konteks (tanpa ini: amnesia tiap pesan).
    messages: new MessageRepositoryPrisma(prisma.message as unknown as MessageDelegate),
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

  return startTelegramPoller({
    botToken: env.TELEGRAM_BOT_TOKEN,
    queue,
    fetch: globalThis.fetch as never,
    ...(env.TELEGRAM_ALLOWLIST ? { allowlistRaw: env.TELEGRAM_ALLOWLIST } : {}),
    ...(alert ? { alert } : {}),
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
export function createMediaDeps(env: ChatWorkerEnv = process.env): MediaDeps | undefined {
  if (!env.TELEGRAM_BOT_TOKEN || !env.CPANEL_FTP_HOST || !env.CPANEL_FTP_USER) return undefined;

  const prisma = createPrismaClient();
  const media = new MediaRepositoryPrisma(prisma.mediaAsset as unknown as MediaDelegate);

  // Koneksi FTP baru tiap simpan: unggahan media jarang & singkat, sedangkan koneksi
  // menganggur akan diputus server (Pure-FTPd: idle 15 menit).
  const store = new FtpsMediaStore(
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
