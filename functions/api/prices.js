
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
  const demo = String(env.CAPITAL_DEMO || "true") === "true";

  if (!apiKey || !identifier || !password) {
    return json({
      error: "Не настроены ключи Capital.com в Cloudflare",
      gold: null,
      bitcoin: null
    }, 503);
  }

  const base = demo
    ? "https://demo-api-capital.backend-capital.com"
    : "https://api-capital.backend-capital.com";

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
        error: "Capital.com не принял вход. Проверьте API-ключ и режим Demo/Live."
      }, 502);
    }

    const cst = loginResponse.headers.get("CST");
    const securityToken = loginResponse.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return json({ error: "Capital.com не вернул токены сессии" }, 502);
    }

    const headers = {
      "X-CAP-API-KEY": apiKey,
      "CST": cst,
      "X-SECURITY-TOKEN": securityToken,
      "Accept": "application/json"
    };

    const searchInstrument = async (terms) => {
      for (const term of terms) {
        const response = await fetch(
          base + "/api/v1/markets?searchTerm=" + encodeURIComponent(term),
          { headers }
        );

        if (!response.ok) continue;

        const body = await response.json();
        const markets = body.markets || [];

        const exact = markets.find(m =>
          String(m.epic || "").toUpperCase() === term.toUpperCase()
        );

        const match = exact || markets.find(m =>
          m.instrumentType === "COMMODITIES" ||
          m.instrumentType === "CRYPTOCURRENCIES"
        );

        if (match && match.epic) return match.epic;
      }
      return null;
    };

    const goldEpic = await searchInstrument(["GOLD", "XAUUSD"]);
    const bitcoinEpic = await searchInstrument(["BTCUSD", "BITCOIN"]);

    const getMarket = async (epic) => {
      if (!epic) return { error: "Инструмент не найден в Capital.com" };

      const response = await fetch(
        base + "/api/v1/markets/" + encodeURIComponent(epic),
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
        return { error: "Capital.com не вернул цену" };
      }

      return {
        bid,
        offer: Number.isFinite(offer) ? offer : null,
        epic,
        history: []
      };
    };

    const [gold, bitcoin] = await Promise.all([
      getMarket(goldEpic),
      getMarket(bitcoinEpic)
    ]);

    return json({ gold, bitcoin, updatedAt: new Date().toISOString() });
  } catch (error) {
    return json({
      error: "Ошибка соединения с Capital.com",
      details: String(error && error.message || error)
    }, 502);
  }
}
