

const corsHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders
  });
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = env.CAPITAL_API_KEY;
  const identifier = env.CAPITAL_IDENTIFIER;
  const password = env.CAPITAL_API_PASSWORD;

  if (!apiKey || !identifier || !password) {
    return json({
      error: "Проверьте секреты Capital.com в Cloudflare",
      gold: null,
      bitcoin: null
    }, 503);
  }

  const base = "https://api-capital.backend-capital.com";

  try {
    const loginResponse = await fetch(base + "/api/v1/session", {
      method: "POST",
      headers: {
        "X-CAP-API-KEY": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        identifier,
        password,
        encryptedPassword: false
      })
    });

    if (!loginResponse.ok) {
      return json({
        error: "Вход в Capital.com Demo не выполнен. Проверьте секреты и API-доступ."
      }, 502);
    }

    const cst = loginResponse.headers.get("CST");
    const securityToken =
      loginResponse.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return json({
        error: "Не получены токены демо-сессии"
      }, 502);
    }

    const headers = {
      "X-CAP-API-KEY": apiKey,
      "CST": cst,
      "X-SECURITY-TOKEN": securityToken,
      "Accept": "application/json"
    };

    async function findMarket(searchTerm, type) {
      const response = await fetch(
        base + "/api/v1/markets?searchTerm=" +
          encodeURIComponent(searchTerm),
        { headers }
      );

      if (!response.ok) return null;

      const body = await response.json();
      const markets = body.markets || [];

      const valid = markets.filter(m =>
        m.epic &&
        m.instrumentType === type &&
        m.marketStatus === "TRADEABLE"
      );

      const exact = valid.find(m =>
        String(m.epic).toUpperCase() ===
        searchTerm.toUpperCase()
      );

      return exact || valid[0] || null;
    }

    const [goldMarket, bitcoinMarket] = await Promise.all([
      findMarket("Gold", "COMMODITIES"),
      findMarket("Bitcoin", "CRYPTOCURRENCIES")
    ]);

    async function getQuote(market) {
      if (!market) {
        return { error: "Рынок не найден или сейчас недоступен" };
      }

      const response = await fetch(
        base + "/api/v1/markets/" +
          encodeURIComponent(market.epic),
        { headers }
      );

      if (!response.ok) {
        return { error: "Не удалось получить котировку" };
      }

      const body = await response.json();
      const snapshot = body.snapshot || {};
      const bid = Number(snapshot.bid);
      const offer = Number(snapshot.offer);

      if (!Number.isFinite(bid) || bid <= 0) {
        return { error: "Цена временно недоступна" };
      }

      return {
        bid,
        offer: Number.isFinite(offer) && offer > 0
          ? offer
          : null,
        epic: market.epic
      };
    }

    const [gold, bitcoin] = await Promise.all([
      getQuote(goldMarket),
      getQuote(bitcoinMarket)
    ]);

    return json({
      gold,
      bitcoin,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return json({
      error: "Ошибка соединения с Capital.com Demo"
    }, 502);
  }
}
