
export async function onRequest({ env }) {
  const base = "https://demo-api-capital.backend-capital.com";

  try {
    const apiKey = env.DEMO_CAPITAL_API_KEY;
    const identifier = env.DEMO_CAPITAL_IDENTIFIER;
    const password = env.DEMO_CAPITAL_API_PASSWORD;

    if (!apiKey || !identifier || !password) {
      return Response.json(
        { error: "Demo API credentials are not configured" },
        { status: 500 }
      );
    }

    const sessionResponse = await fetch(
      `${base}/api/v1/session`,
      {
        method: "POST",
        headers: {
          "X-CAP-API-KEY": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ identifier, password })
      }
    );

    if (!sessionResponse.ok) {
      return Response.json(
        { error: "Could not authenticate with Demo account" },
        { status: 502 }
      );
    }

    const cst = sessionResponse.headers.get("CST");
    const securityToken =
      sessionResponse.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return Response.json(
        { error: "Demo session tokens are missing" },
        { status: 502 }
      );
    }

    const historyResponse = await fetch(
      `${base}/api/v1/history/transactions?lastPeriod=604800`,
      {
        headers: {
          "CST": cst,
          "X-SECURITY-TOKEN": securityToken,
          "Accept": "application/json"
        }
      }
    );

    if (!historyResponse.ok) {
      return Response.json(
        { error: "Could not load transaction history" },
        { status: 502 }
      );
    }

    const data = await historyResponse.json();

    return Response.json(
      {
        mode: "DEMO",
        periodDays: 7,
        transactions: Array.isArray(data.transactions)
          ? data.transactions
          : [],
        count: Array.isArray(data.transactions)
          ? data.transactions.length
          : 0,
        updatedAt: new Date().toISOString()
      },
      {
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  } catch {
    return Response.json(
      { error: "History service temporarily unavailable" },
      { status: 502 }
    );
  }
}
