

const BASE_URL = "https://api-capital.backend-capital.com";
const DEMO_URL = "https://demo-api-capital.backend-capital.com";

function json(data, status = 200, cache = false) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache
        ? "public, max-age=20, s-maxage=30"
        : "no-store"
    }
  });
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();

  let data;

  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.errorCode ||
      data.error ||
      `Capital.com HTTP ${response.status}`
    );
  }

  return { data, response };
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Безопасный режим по умолчанию — Demo.
  // Для реального счёта потребуется явно установить CAPITAL_DEMO=false.
  const useDemo =
    String(env.CAPITAL_DEMO || "true").toLowerCase() === "true";

  const base = useDemo ? DEMO_URL : BASE_URL;
  const mode = useDemo ? "DEMO" : "LIVE";

  // Для Demo и Live используются отдельные секреты.
  const apiKey = useDemo
    ? env.DEMO_CAPITAL_API_KEY
    : env.CAPITAL_API_KEY;

  const password = useDemo
    ? env.DEMO_CAPITAL_API_PASSWORD
    : env.CAPITAL_API_PASSWORD;

  const identifier = useDemo
    ? env.DEMO_CAPITAL_IDENTIFIER
    : env.CAPITAL_IDENTIFIER;

  if (!apiKey || !password || !identifier) {
    return json({
      error: useDemo
        ? "Не настроены секреты Capital.com Demo в Cloudflare"
        : "Не настроены секреты Capital.com Live в Cloudflare",
      mode
    }, 500);
  }

  // Раздельный кэш, чтобы режимы не смешивались.
  const cache = caches.default;
  const cacheUrl = new URL(request.url);

  cacheUrl.pathname = useDemo
    ? "/__cached_prices_demo"
    : "/__cached_prices_live";

  cacheUrl.search = "";

  const cacheKey = new Request(cacheUrl.toString(), {
    method: "GET"
  });

  try {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
  } catch {
    // Продолжаем, если кэш недоступен.
  }

  try {
    const session = await apiFetch(base + "/api/v1/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAP-API-KEY": apiKey,
        "Accept": "application/json",
        "Version": "1"
      },
      body: JSON.stringify({
        identifier,
        password,
        encryptedPassword: false
      })
    });

    const cst = session.response.headers.get("CST");
    const security =
      session.response.headers.get("X-SECURITY-TOKEN");

    if (!cst || !security) {
      throw new Error(
        "Capital.com не вернул токены сессии"
      );
    }

    const headers = {
      "CST": cst,
      "X-SECURITY-TOKEN": security,
      "X-CAP-API-KEY": apiKey,
      "Accept": "application/json",
      "Version": "1"
    };

    async function findPrice(searchTerm, matcher) {
      const url =
        base + "/api/v1/markets?searchTerm=" +
        encodeURIComponent(searchTerm);

      const result = await apiFetch(url, { headers });
      const markets = result.data.markets || [];

      const market = markets.find(item =>
        item.marketStatus === "TRADEABLE" &&
        item.streamingPricesAvailable !== false &&
        matcher(item)
      );

      if (!market) {
        return {
          error: "Инструмент не найден или сейчас недоступен"
        };
      }

      const bid = Number(market.bid);
      const ask = Number(market.offer);

      if (!Number.isFinite(bid) || bid <= 0) {
        return {
          error: "Capital.com не вернул цену покупки/продажи"
        };
      }

      return {
        bid,
        ask: Number.isFinite(ask) && ask > 0 ? ask : null,
        epic: market.epic,
        name: market.instrumentName
      };
    }

    const [gold, bitcoin] = await Promise.all([
      findPrice("Gold", item =>
        /gold/i.test(item.instrumentName || "")
      ),
      findPrice("Bitcoin", item =>
        /bitcoin/i.test(item.instrumentName || "") ||
        /BTC/i.test(item.epic || "")
      )
    ]);

    const result = json({
      gold,
      bitcoin,
      mode,
      updatedAt: new Date().toISOString()
    }, 200, true);

    try {
      await cache.put(cacheKey, result.clone());
    } catch {
      // Ответ вернётся и без кэширования.
    }

    return result;
  } catch (error) {
    return json({
      error: "Ошибка Capital.com: " +
        (error.message || "не удалось получить цены"),
      mode
    }, 502);
  }
}
