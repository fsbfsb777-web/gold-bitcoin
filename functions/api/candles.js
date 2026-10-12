
const LIVE_URL = "https://api-capital.backend-capital.com";
const DEMO_URL = "https://demo-api-capital.backend-capital.com";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
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
      data.errorCode || data.error || "Capital.com HTTP " + response.status
    );
  }

  return { data, response };
}

function numberFromPrice(price) {
  if (!price) return null;

  const value = Number(
    price.bid !== undefined && price.bid !== null
      ? price.bid
      : price.ask
  );

  return Number.isFinite(value) && value > 0 ? value : null;
}

function convertCandle(item) {
  const open = numberFromPrice(item.openPrice);
  const high = numberFromPrice(item.highPrice);
  const low = numberFromPrice(item.lowPrice);
  const close = numberFromPrice(item.closePrice);

  if (
    open === null ||
    high === null ||
    low === null ||
    close === null
  ) {
    return null;
  }

  return {
    time: item.snapshotTimeUTC || item.snapshotTime || null,
    open,
    high,
    low,
    close
  };
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Разрешён только GET-запрос" }, 405);
  }

  const apiKey = env.CAPITAL_API_KEY;
  const password = env.CAPITAL_API_PASSWORD;
  const identifier = env.CAPITAL_IDENTIFIER;

  if (!apiKey || !password || !identifier) {
    return json({
      error: "Не настроены секреты Capital.com в Cloudflare"
    }, 500);
  }

  const url = new URL(request.url);

  const allowed = [
    "MINUTE",
    "MINUTE_5",
    "MINUTE_15",
    "HOUR"
  ];

  const requested = url.searchParams.get("resolution") || "MINUTE";
  const resolution = allowed.includes(requested)
    ? requested
    : "MINUTE";

  const rawCount = Number(url.searchParams.get("count") || 100);
  const count = Number.isFinite(rawCount)
    ? Math.min(200, Math.max(20, Math.floor(rawCount)))
    : 100;

  const demo =
    String(env.CAPITAL_DEMO || "").toLowerCase() === "true";

  const base = demo ? DEMO_URL : LIVE_URL;

  try {
    const session = await apiFetch(base + "/api/v1/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CAP-API-KEY": apiKey
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
      throw new Error("Capital.com не вернул токены сессии");
    }

    const headers = {
      "CST": cst,
      "X-SECURITY-TOKEN": security,
      "Accept": "application/json"
    };

    async function getCandles(epic) {
      const endpoint =
        base +
        "/api/v1/prices/" +
        encodeURIComponent(epic) +
        "?resolution=" +
        encodeURIComponent(resolution) +
        "&max=" +
        count;

      const result = await apiFetch(endpoint, { headers });

      const candles = (result.data.prices || [])
        .map(convertCandle)
        .filter(Boolean);

      return {
        epic,
        candles
      };
    }

    const [gold, bitcoin] = await Promise.all([
      getCandles("GOLD"),
      getCandles("BTCUSD")
    ]);

    return json({
      resolution,
      gold: gold.candles,
      bitcoin: bitcoin.candles,
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return json({
      error: "Не удалось получить свечи: " + error.message
    }, 502);
  }
}
