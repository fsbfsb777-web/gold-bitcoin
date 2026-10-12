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
export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }
  const apiKey = env.CAPITAL_API_KEY;
  const identifier = env.CAPITAL_IDENTIFIER;
  const password = env.CAPITAL_API_PASSWORD;
  if (!apiKey || !identifier || !password) {
    return json({
      error: "В Cloudflare не хватает одного или нескольких секретов",
      gold: null,
      bitcoin: null
    }, 503);
  }
  // Реальный Capital.com Live API
  const base = "https://api-capital.backend-capital.com";
  try {
    // 1. Вход в Capital.com
    const loginResponse = await fetch(
      base + "/api/v1/session",
      {
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
      }
    );
    if (!loginResponse.ok) {
      return json({
        error: "Capital.com Live отклонил вход",
        httpStatus: loginResponse.status,
        hint:
          loginResponse.status === 401
            ? "Проверьте API key, Identifier и пароль API-ключа"
            : loginResponse.status === 403
            ? "Проверьте разрешения API и доступ к Live-счёту"
            : loginResponse.status === 429
            ? "Слишком много запросов. Подождите и попробуйте снова"
            : "Проверьте настройки API в Capital.com"
      }, 502);
    }
    const cst = loginResponse.headers.get("CST");
    const securityToken =
      loginResponse.headers.get("X-SECURITY-TOKEN");
    if (!cst || !securityToken) {
      return json({
        error: "Capital.com не вернул токены сессии"
      }, 502);
    }
    const headers = {
      "X-CAP-API-KEY": apiKey,
      "CST": cst,
      "X-SECURITY-TOKEN": securityToken,
      "Accept": "application/json"
    };
    // 2. Поиск подходящего рынка
    async function findMarket(searchTerm, instrumentType) {
      const response = await fetch(
        base + "/api/v1/markets?searchTerm=" +
          encodeURIComponent(searchTerm),
        { headers }
      );
      if (!response.ok) {
        return {
          error: "Ошибка поиска рынка",
          httpStatus: response.status
        };
      }
      const body = await response.json();
      const markets = body.markets || [];
      const matching = markets.filter(m =>
        m.epic &&
        m.instrumentType === instrumentType
      );
      const tradeable = matching.find(m =>
        m.marketStatus === "TRADEABLE"
      );
      const market = tradeable || matching[0];
      if (!market) {
        return {
          error: "Подходящий рынок не найден: " + searchTerm
        };
      }
      return market;
    }
    const [goldMarket, bitcoinMarket] = await Promise.all([
      findMarket("Gold", "COMMODITIES"),
      findMarket("Bitcoin", "CRYPTOCURRENCIES")
    ]);
    // 3. Получение котировки
    async function getQuote(market) {
      if (market.error) {
        return market;
      }
      const response = await fetch(
        base + "/api/v1/markets/" +
          encodeURIComponent(market.epic),
        { headers }
      );
      if (!response.ok) {
        return {
          error: "Не удалось получить котировку",
          httpStatus: response.status,
          epic: market.epic
        };
      }
      const body = await response.json();
      const snapshot = body.snapshot || {};
      const bid = Number(snapshot.bid);
      const offer = Number(snapshot.offer);
      if (!Number.isFinite(bid) || bid <= 0) {
        return {
          error: "Цена временно недоступна",
          epic: market.epic
        };
      }
      return {
        bid,
        offer:
          Number.isFinite(offer) && offer > 0
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
      mode: "LIVE",
      gold,
      bitcoin,
      updatedAt: new Date().toISOString()
    });
  } catch {
    return json({
      error: "Не удалось соединиться с Capital.com Live"
    }, 502);
  }
}

