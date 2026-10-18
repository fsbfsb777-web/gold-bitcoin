export async function onRequestPost(context) {
  const { env, request } = context;
  const DEMO_URL = "https://demo-api-capital.backend-capital.com";
  
  const apiKey = env.DEMO_CAPITAL_API_KEY;
  const identifier = env.DEMO_CAPITAL_IDENTIFIER;
  const password = env.DEMO_CAPITAL_API_PASSWORD;

  if (!apiKey || !identifier || !password) {
    return new Response(JSON.stringify({ error: "Не настроены секреты Capital.com Demo" }), { status: 500 });
  }

  try {
    const body = await request.json(); // Получаем данные с сайта (включая size)

    // 1. Логин
    const loginRes = await fetch(DEMO_URL + "/api/v1/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CAP-API-KEY": apiKey },
      body: JSON.stringify({ identifier, password, encryptedPassword: false })
    });
    
    if (!loginRes.ok) throw new Error("Ошибка логина Capital.com");
    
    const cst = loginRes.headers.get("CST");
    const token = loginRes.headers.get("X-SECURITY-TOKEN");

    // 2. Отправка ордера
    const orderRes = await fetch(DEMO_URL + "/api/v1/positions", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json", 
        "X-CAP-API-KEY": apiKey, 
        "CST": cst, 
        "X-SECURITY-TOKEN": token 
      },
      body: JSON.stringify({
        epic: body.symbol === "XAUUSD" ? "GOLD" : "BITCOIN",
        direction: body.side,
        size: body.size || 0.01,  // БЕРЕМ РАЗМЕР С САЙТА!
        stopLevel: body.stop,
        profitLevel: body.target
      })
    });

    const orderData = await orderRes.json();
    
    if (!orderRes.ok) {
        throw new Error(JSON.stringify(orderData));
    }

    return new Response(JSON.stringify({ ok: true, dealId: orderData.dealReference }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
