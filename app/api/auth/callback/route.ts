import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.json(
      { error, details: "Mercado Libre devolvió un error en el callback." },
      { status: 400 }
    );
  }

  if (!code) {
    return NextResponse.json(
      { error: "Falta `code` en el callback." },
      { status: 400 }
    );
  }

  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const redirectUri = process.env.ML_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return NextResponse.json(
      { error: "Faltan variables de entorno ML_* para el intercambio de token." },
      { status: 500 }
    );
  }

  // Paso 2: intercambiar código por access_token
  const tokenRes = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const tokenJson = await tokenRes.json().catch(() => null);
  const accessToken = tokenJson?.access_token as string | undefined;

  if (!tokenRes.ok || !accessToken) {
    return NextResponse.json(
      { error: "Error al obtener access_token desde Mercado Libre.", details: tokenJson ?? null },
      { status: 500 }
    );
  }

  // Obtener user_id desde /users/me
  const meRes = await fetch("https://api.mercadolibre.com/users/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const meJson = await meRes.json().catch(() => null);

  const userId =
    (meJson?.id as string | undefined) ??
    (meJson?.user_id as string | undefined) ??
    (typeof meJson?.id === "number" ? String(meJson.id) : undefined);

  if (!meRes.ok || !userId) {
    return NextResponse.json(
      { error: "Error al obtener user_id desde Mercado Libre.", details: meJson ?? null },
      { status: 500 }
    );
  }

  const expiresIn = parseNumber(tokenJson?.expires_in);
  const maxAge = expiresIn > 0 ? expiresIn : undefined; // segundos
  const secure = process.env.NODE_ENV === "production";

  const res = NextResponse.redirect(new URL("/dashboard", req.url), 302);

  res.cookies.set("access_token", accessToken, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  });
  res.cookies.set("user_id", userId, {
    httpOnly: true,
    secure,
    sameSite: "lax",
    path: "/",
    ...(maxAge ? { maxAge } : {}),
  });

  // Asegura que las cookies queden presentes en el contexto actual.
  cookies(); // no-op, ayuda a evitar edge cases de types/runtime

  return res;
}

