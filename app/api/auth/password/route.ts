import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const password = body?.password as string | undefined;

  const expectedPassword = process.env.PASSWORD_DASHBOARD;
  const refreshToken     = process.env.ML_REFRESH_TOKEN;
  const userId           = process.env.ML_USER_ID;
  const clientId         = process.env.ML_CLIENT_ID;
  const clientSecret     = process.env.ML_CLIENT_SECRET;

  if (!expectedPassword || !refreshToken || !userId || !clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Variables de entorno no configuradas (PASSWORD_DASHBOARD, ML_REFRESH_TOKEN, ML_USER_ID)." },
      { status: 500 }
    );
  }

  if (!password || password !== expectedPassword) {
    return NextResponse.json({ error: "Contraseña incorrecta." }, { status: 401 });
  }

  // Refrescar el access_token usando el refresh_token del dueño
  const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });

  const tokenJson = await tokenRes.json().catch(() => null);
  const accessToken = tokenJson?.access_token as string | undefined;

  if (!tokenRes.ok || !accessToken) {
    return NextResponse.json(
      { error: "Error al refrescar el token de ML.", details: tokenJson },
      { status: 500 }
    );
  }

  const expiresIn = typeof tokenJson?.expires_in === "number" ? tokenJson.expires_in : undefined;
  const secure    = process.env.NODE_ENV === "production";

  const res = NextResponse.json({ ok: true });
  res.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(expiresIn ? { maxAge: expiresIn } : {}),
  });
  res.cookies.set("user_id", userId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
  });

  return res;
}
