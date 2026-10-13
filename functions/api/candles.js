
const LIVE_URL = "https://api-capital.backend-capital.com";
const DEMO_URL = "https://demo-api-capital.backend-capital.com";

// Повторно используем сессию, пока она действительна.
// Cloudflare может сбрасывать память между запросами.
let savedSession = null;
let sessionExpiresAt = 0;
let sessionPromise = null;

const ALLOWED_RESOLUTIONS = new Set([
  "MINUTE",
  "MINUTE_5",
  "MINUTE_15",
  "HOUR",
  "HOUR_4",
  "DAY"
]);

function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": maxAge
        ? `public, max-age=${maxAge}, s-maxage=${maxAge}`
        : "no-store"
    }
  });
}

function priceValue(value) {
  if (!value || typeof value !== "object") return null;

  const bid = Number(value.bid);
  const ask = Number(value.ask);

  if (Number.isFinite(bid) && Number.isFinite(ask)) {
    return (bid + ask) / 2;
  }

  if (Number.isFinite(bid)) return bid;
  if (Number.isFinite(ask)) return ask;

  return null;
}

function convertPrice(item) {
  const open = priceValue(item.openPrice);
  const high = priceValue(item.highPrice);
  const low = priceValue(item.lowPrice);
  const close = priceValue(item.closePrice);

  if ([open, high, low, close].some(v => v === null)) {
    return null;
  }

  const time = item.snapshotTimeUTC || item.snapshotTime;
  if (!time) return null;

  return { time, open, high, low, close };
}

async function readJson(response) {
  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Capital.com вернул некорректный ответ");
  }

  if (!response.ok) {
    throw new Error(
      data.errorCode ||
      data.error ||
      `Capital.com HTTP ${response.status}`
    );
  }

  return data;
}

async function createSession(baseUrl, env) {
  const response = await fetch(`${baseUrl}/api/v1/session`, {
    method: "POST",
    headers: {
      "X-CAP-API-KEY": env.CAPITAL_API_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Version": "1"
    },
    body: JSON.stringify({
      identifier: env.CAPITAL_IDENTIFIER,
      password: env.CAPITAL_API_PASSWORD,
      encryptedPassword: false
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Capital.com session HTTP ${response.status}: ${body.slice(0, 180)}`
    );
  }

  const cst = response.headers.get("CST");
  const securityToken = response.headers.get("X-SECURITY-TOKEN");

  if (!cst || !securityToken) {
    throw new Error("Capital.com не вернул токены сессии");
  }

  return { cst, securityToken };
}

async function getSession(baseUrl, env, forceRefresh = false) {
  if (
    !forceRefresh &&
    savedSession &&
    Date.now() < sessionExpiresAt
  ) {
    return savedSession;
  }

  // Не создаём несколько сессий одновременно в одном изоляте.
  if (sessionPromise) return sessionPromise;

  sessionPromise = (async () => {
    const session = await createSession(baseUrl, env);
    savedSession = session;

    // Обновляем сессию заранее, не дожидаясь истечения.
    sessionExpiresAt = Date.now() + 7 * 60 * 1000;

    return session;
  })();

  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
}

async function capitalFetch(url, baseUrl, env) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const session = await getSession(
      baseUrl,
      env,
      attempt === 1
    );

    const response = await fetch(url, {
      headers: {
        "X-CAP-API-KEY": env.CAPITAL_API_KEY,
        "CST": session.cst,
        "X-SECURITY-TOKEN": session.securityToken,
        "Accept": "application/json",
        "Version": "1"
      }
    });

    if (
      attempt === 0 &&
      (response.status === 401 || response.status === 403)
    ) {
      savedSession = null;
      sessionExpiresAt = 0;
      continue;
    }

    return readJson(response);
  }

  throw new Error("Не удалось обновить сессию Capital.com");
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);
  const resolution = url.searchParams.get("resolution") || "MINUTE";

  if (!ALLOWED_RESOLUTIONS.has(resolution)) {
    return json({ error: "Unsupported resolution" }, 400);
  }

  const identifier = env.CAPITAL_IDENTIFIER;
  const password = env.CAPITAL_API_PASSWORD;
  const apiKey = env.CAPITAL_API_KEY;

  if (!identifier || !password || !apiKey) {
    return json({
      error: "Capital.com credentials are missing"
    }, 500);
  }

  const baseUrl =
    env.CAPITAL_DEMO === "true" ? DEMO_URL : LIVE_URL;

  // Кэшируем каждый таймфрейм отдельно.
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = "/__cached_candles";
  cacheUrl.search = `?resolution=${encodeURIComponent(resolution)}`;

  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET"
  });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // Если кэш недоступен, запрашиваем данные напрямую.
  }

  try {
    const getCandles = async epic => {
      const endpoint = new URL(
        `${baseUrl}/api/v1/prices/${epic}`
      );

      endpoint.searchParams.set("resolution", resolution);
      endpoint.searchParams.set("max", "100");

      const result = await capitalFetch(
        endpoint.toString(),
        baseUrl,
        env
      );

      return (result.prices || [])
        .map(convertPrice)
        .filter(Boolean);
    };

    const [gold, bitcoin] = await Promise.all([
      getCandles("GOLD"),
      getCandles("BTCUSD")
    ]);

    const result = json({
      resolution,
      gold,
      bitcoin,
      updatedAt: new Date().toISOString()
    }, 200, 10);

    try {
      await cache.put(cacheKey, result.clone());
    } catch {
      // Отдаём результат и без кэширования.
    }

    return result;
  } catch (error) {
    return json({
      error: error.message || "Failed to load candles"
    }, 502);
  }
}
