
const LIVE_URL = "https://api-capital.backend-capital.com";
const DEMO_URL = "https://demo-api-capital.backend-capital.com";

function json(data, status = 200, cache = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache
        ? "public, max-age=15, s-maxage=30"
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

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  return {
    time: item.snapshotTimeUTC || item.snapshotTime,
    open,
    high,
    low,
    close
  };
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Capital.com вернул некорректный ответ");
  }

  if (!response.ok) {
    throw new Error(
      data.errorCode || data.error || `Capital.com HTTP ${response.status}`
    );
  }

  return data;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const url = new URL(request.url);

  const allowed = [
    "MINUTE",
    "MINUTE_5",
    "MINUTE_15",
    "HOUR",
    "HOUR_4",
    "DAY"
  ];

  const resolution = url.searchParams.get("resolution") || "MINUTE";

  if (!allowed.includes(resolution)) {
    return json({ error: "Unsupported resolution" }, 400);
  }

  // Кэшируем готовые свечи, чтобы не создавать
  // новую сессию Capital.com при каждом обновлении.
  const cache = caches.default;
  const cacheUrl = new URL(request.url);
  cacheUrl.pathname = "/__cached_candles";
  cacheUrl.search = `?resolution=${resolution}`;

  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET"
  });

  try {
    const cached = await cache.match(cacheKey);

    if (cached) {
      return cached;
    }
  } catch {
    // Если кэш недоступен, продолжаем запрос.
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

  try {
    // Одна сессия на получение обоих инструментов.
    const sessionResponse = await fetch(
      `${baseUrl}/api/v1/session`,
      {
        method: "POST",
        headers: {
          "X-CAP-API-KEY": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Version": "1"
        },
        body: JSON.stringify({
          identifier,
          password,
          encryptedPassword: false
        })
      }
    );

    if (!sessionResponse.ok) {
      const errorText = await sessionResponse.text();

      return json({
        error: "Capital.com session failed",
        details: errorText.slice(0, 500)
      }, sessionResponse.status);
    }

    const cst = sessionResponse.headers.get("CST");
    const securityToken =
      sessionResponse.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return json({
        error: "Capital.com session tokens are missing"
      }, 502);
    }

    const headers = {
      "X-CAP-API-KEY": apiKey,
      "CST": cst,
      "X-SECURITY-TOKEN": securityToken,
      "Accept": "application/json",
      "Version": "1"
    };

    async function getCandles(epic) {
      const endpoint = new URL(
        `${baseUrl}/api/v1/prices/${epic}`
      );

      endpoint.searchParams.set("resolution", resolution);
      endpoint.searchParams.set("max", "100");

      const result = await apiFetch(endpoint.toString(), {
        headers
      });

      return (result.prices || [])
        .map(convertPrice)
        .filter(Boolean);
    }

    const [gold, bitcoin] = await Promise.all([
      getCandles("GOLD"),
      getCandles("BTCUSD")
    ]);

    const result = json({
      resolution,
      gold,
      bitcoin,
      updatedAt: new Date().toISOString()
    }, 200, true);

    try {
      await cache.put(cacheKey, result.clone());
    } catch {
      // Ответ всё равно будет возвращён без кэширования.
    }

    return result;

  } catch (error) {
    return json({
      error: error.message || "Failed to load candles"
    }, 502);
  }
}

