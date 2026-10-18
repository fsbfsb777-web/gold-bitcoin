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
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    // Ответ не является JSON.
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

  // Используем исключительно отдельные Demo-секреты.
  const apiKey = env.DEMO_CAPITAL_API_KEY;
  const identifier = env.DEMO_CAPITAL_IDENTIFIER;
  const password = env.DEMO_CAPITAL_API_PASSWORD;

  if (!apiKey || !identifier || !password) {
    return json({
      error: "Не настроены секреты Capital.com Demo (проверьте Environment Variables в Cloudflare)"
    }, 500);
  }

  try {
    // Создаём сессию только на Demo API.
    const session = await apiFetch(
      DEMO_URL + "/api/v1/session",
      {
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
      }
    );

    const cst = session.response.headers.get("CST");
    const security = session.response.headers.get("X-SECURITY-TOKEN");

    if (!cst || !security) {
      throw new Error("Не удалось создать Demo-сессию");
    }

    const headers = {
      "CST": cst,
      "X-SECURITY-TOKEN": security,
      "X-CAP-API-KEY": apiKey,
      "Accept": "application/json",
      "Version": "1"
    };

    // Запрашиваем счета и открытые позиции.
    const [accountsResult, positionsResult] = await Promise.all([
      apiFetch(DEMO_URL + "/api/v1/accounts", { headers }),
      apiFetch(DEMO_URL + "/api/v1/positions", { headers })
    ]);

    const accounts = accountsResult.data.accounts || [];
    const positions = positionsResult.data.positions || [];
    
    // БЕРЕМ ПЕРВЫЙ СЧЕТ ИЗ МАССИВА
    const primaryAccount = accounts[0] || {};
    const balanceInfo = primaryAccount.balance || {};

    return json({
      mode: "DEMO",
      currency: primaryAccount.currency || null,

      // ИСПРАВЛЕНО: Берем баланс из primaryAccount.balance
      balance: balanceInfo.balance ?? null,
      available: balanceInfo.available ?? null,
      deposit: balanceInfo.deposit ?? null,
      profitLoss: balanceInfo.profitLoss ?? null,

      accounts: accounts.map(account => ({
        accountName: account.accountName || null,
        accountType: account.accountType || null,
        preferred: account.preferred ?? null,
        balance: account.balance?.balance ?? null,
        available: account.balance?.available ?? null,
        currency: account.currency || null
      })),

      openPositions: positions.map(item => ({
        dealId: item.position?.dealId || null,
        epic: item.market?.epic || null,
        name: item.market?.instrumentName || null,
        direction: item.position?.direction || null,
        size: item.position?.size ?? null,
        level: item.position?.level ?? null,
        currentPrice: item.position?.direction === "BUY"
          ? item.market?.bid ?? null
          : item.market?.offer ?? null,
        profitLoss: item.position?.upl ?? null,
        currency: item.position?.currency || null
      })),

      positionsCount: positions.length,
      updatedAt: new Date().toISOString()
    });

  } catch (error) {
    return json({
      mode: "DEMO",
      error: "Ошибка получения данных Demo: " + (error.message || "неизвестная ошибка")
    }, 502);
  }
}

