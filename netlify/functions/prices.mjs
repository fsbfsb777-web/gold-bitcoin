
export default async (request) => {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8" }
    });

  if (request.method !== "GET") {
    return json({ error: "Разрешён только GET-запрос" }, 405);
  }

  const apiKey = process.env.CAPITAL_API_KEY;
  const identifier = process.env.CAPITAL_IDENTIFIER;
  const apiPassword = process.env.CAPITAL_API_PASSWORD;
  const demo = process.env.CAPITAL_DEMO !== "false";

  if (!apiKey || !identifier || !apiPassword) {
    return json({
      error: "Не настроены переменные Capital.com в Netlify"
    }, 503);
  }

  const base = demo
    ? "https://demo-api-capital.backend-capital.com"
    : "https://api-capital.backend-capital.com";

  try {
    const login = await fetch(`${base}/api/v1/session`, {
      method: "POST",
      headers: {
        "X-CAP-API-KEY": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        identifier,
        password: apiPassword,
        encryptedPassword: false
      })
    });

    if (!login.ok) {
      return json({
        error: "Capital.com не принял данные API. Проверьте настройки."
      }, 502);
    }

    const cst = login.headers.get("CST");
    const securityToken = login.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return json({ error: "Не получен токен Capital.com" }, 502);
    }

    const headers = {
      "CST": cst,
      "X-SECURITY-TOKEN": securityToken,
      "X-CAP-API-KEY": apiKey,
      "Accept": "application/json"
    };

    async function findMarket(term, preferred) {
      const response = await fetch(
        `${base}/api/v1/markets?searchTerm=${encodeURIComponent(term)}`,
        { headers }
      );

      if (!response.ok) throw new Error("Не удалось найти инструмент");

      const data = await response.json();
      const markets = data.markets || [];

      const market = markets.find(m =>
        preferred.test(`${m.instrumentName || ""} ${m.epic || ""}`)
      ) || markets.find(m =>
        /TRADEABLE|TRADEABLE_WITH_RESTRICTIONS/.test(m.marketStatus || "")
      );

      if (!market || !market.epic) {
        return { name: term, error: "Инструмент не найден" };
      }

      const details = await fetch(
        `${base}/api/v1/markets/${encodeURIComponent(market.epic)}`,
        { headers }
      );

      if (!details.ok) {
        return { name: market.instrumentName || term,
                 error: "Не удалось получить цену" };
      }

      const result = await details.json();
      const snapshot = result.snapshot || {};

      return {
        name: market.instrumentName || term,
        epic: market.epic,
        bid: snapshot.bid ?? null,
        offer: snapshot.offer ?? null,
        marketStatus: snapshot.marketStatus || market.marketStatus || "UNKNOWN",
        time: snapshot.updateTime || null
      };
    }

    const [gold, bitcoin] = await Promise.all([
      findMarket("Gold", /GOLD|XAU.?USD/i),
      findMarket("Bitcoin", /BITCOIN|BTC.?USD/i)
    ]);

    return json({
      source: demo ? "Capital.com demo" : "Capital.com live",
      updatedAt: new Date().toISOString(),
      gold,
      bitcoin
    });
  } catch {
    return json({
      error: "Не удалось связаться с Capital.com. Попробуйте позже."
    }, 502);
  }
};
