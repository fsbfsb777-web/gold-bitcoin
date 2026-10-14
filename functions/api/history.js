
export async function onRequest({ env }) {
  const base = "https://demo-api-capital.backend-capital.com";

  try {
    const apiKey = env.DEMO_CAPITAL_API_KEY;
    const identifier = env.DEMO_CAPITAL_IDENTIFIER;
    const password = env.DEMO_CAPITAL_API_PASSWORD;

    if (!apiKey || !identifier || !password) {
      return Response.json(
        { error: "Demo credentials are missing" },
        { status: 500 }
      );
    }

    const session = await fetch(`${base}/api/v1/session`, {
      method: "POST",
      headers: {
        "X-CAP-API-KEY": apiKey,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ identifier, password })
    });

    if (!session.ok) {
      return Response.json({
        error: "Session failed",
        upstreamStatus: session.status,
        details: (await session.text()).slice(0, 500)
      }, { status: 502 });
    }

    const cst = session.headers.get("CST");
    const securityToken = session.headers.get("X-SECURITY-TOKEN");

    if (!cst || !securityToken) {
      return Response.json({
        error: "Session tokens are missing"
      }, { status: 502 });
    }

    const response = await fetch(
      `${base}/api/v1/history/transactions?lastPeriod=86400`,
      {
        headers: {
          "X-CAP-API-KEY": apiKey,
          "CST": cst,
          "X-SECURITY-TOKEN": securityToken,
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      return Response.json({
        error: "Transaction history request failed",
        upstreamStatus: response.status,
        details: (await response.text()).slice(0, 500)
      }, { status: 502 });
    }

    const data = await response.json();
    const transactions = Array.isArray(data.transactions)
      ? data.transactions
      : [];

    return Response.json({
      mode: "DEMO",
      periodDays: 1,
      transactions,
      count: transactions.length,
      updatedAt: new Date().toISOString()
    }, {
      headers: { "Cache-Control": "no-store" }
    });

  } catch {
    return Response.json({
      error: "History service unavailable"
    }, { status: 502 });
  }
}

