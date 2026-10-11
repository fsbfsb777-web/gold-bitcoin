


export default async (request) => {
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8"
      }
    });

  if (request.method !== "GET") {
    return json({ error: "Разрешён только GET-запрос" }, 405);
  }

  const url = new URL(request.url);
  const allowedResolutions = new Set([
    "MINUTE",
    "MINUTE_5",
    "MINUTE_15",
    "HOUR"
  ]);
  const requestedResolution =
    url.searchParams.get("resolution") || "MINUTE";
  const resolution = allowedResolutions.has(requestedResolution)
    ? requestedResolution
    : "MINUTE";

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
      const details = await login.text();
      console.error(
        "Capital.com login error:",
        login.status,
        details
      );
      return json({
        error: "Capital.com: ошибка авторизации",
        status: login.status,
        details: details.slice(0, 300)
      }, 502);
    }

    const cst = login.headers.get("CST");
    const securityToken =
      login.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return json({
        error: "Не получен токен Capital.com"
      }, 502);
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

      if (!response.ok) {
        throw new Error("Не удалось найти инструмент");
      }

      const data = await response.json();
      const markets = data.markets || [];

      const market = markets.find((item) =>
        preferred.test(
          `${item.instrumentName || ""} ${item.epic || ""}`
        )
      ) || markets.find((item) =>
        /TRADEABLE|TRADEABLE_WITH_RESTRICTIONS/.test(
          item.marketStatus || ""
        )
      );

      if (!market || !market.epic) {
        return {
          name: term,
          error: "Инструмент не найден",
          history: []
        };
      }

      const details = await fetch(
        `${base}/api/v1/markets/${encodeURIComponent(market.epic)}`,
        { headers }
      );

      if (!details.ok) {
        return {
          name: market.instrumentName || term,
          epic: market.epic,
          error: "Не удалось получить цену",
          history: []
        };
      }

      const result = await details.json();
      const snapshot = result.snapshot || {};
      let history = [];

      try {
        const pricesResponse = await fetch(
          `${base}/api/v1/prices/${encodeURIComponent(market.epic)}?resolution=${encodeURIComponent(resolution)}&max=100`,
          { headers }
        );

        if (pricesResponse.ok) {
          const pricesData = await pricesResponse.json();

          history = (pricesData.prices || [])
            .map((candle) => {
              const close = candle.closePrice || {};
              const bid = close.bid == null
                ? NaN
                : Number(close.bid);
              const ask = close.ask == null
                ? NaN
                : Number(close.ask);

              const value =
                Number.isFinite(bid) && Number.isFinite(ask)
                  ? (bid + ask) / 2
                  : Number.isFinite(bid)
                    ? bid
                    : Number.isFinite(ask)
                      ? ask
                      : null;

              return {
                time:
                  candle.snapshotTimeUTC ||
                  candle.snapshotTime ||
                  null,
                close: value
              };
            })
            .filter((candle) =>
              candle.close !== null &&
              Number.isFinite(candle.close)
            );
        } else {
          console.warn(
            "Capital.com history unavailable:",
            pricesResponse.status,
            market.epic
          );
        }
      } catch (historyError) {
        console.warn(
          "Capital.com history request failed:",
          market.epic,
          historyError.message
        );
      }

      return {
        name: market.instrumentName || term,
        epic: market.epic,
        bid: snapshot.bid ?? null,
        offer: snapshot.offer ?? null,
        marketStatus:
          snapshot.marketStatus ||
          market.marketStatus ||
          "UNKNOWN",
        time: snapshot.updateTime || null,
        history
      };
    }

    const [gold, bitcoin] = await Promise.all([
      findMarket("Gold", /GOLD|XAU.?USD/i),
      findMarket("Bitcoin", /BITCOIN|BTC.?USD/i)
    ]);

    return json({
      source: demo
        ? "Capital.com demo"
        : "Capital.com live",
      resolution,
      updatedAt: new Date().toISOString(),
      gold,
      bitcoin,
      history: {
        gold: Array.isArray(gold.history) ? gold.history : [],
        bitcoin: Array.isArray(bitcoin.history)
          ? bitcoin.history
          : []
      }
    });
  } catch (error) {
    console.error("Prices function error:", error.message);
    return json({
      error:
        "Не удалось связаться с Capital.com. Попробуйте позже."
    }, 502);
  }
};


