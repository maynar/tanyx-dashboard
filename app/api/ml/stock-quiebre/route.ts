import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const TANYX_API = process.env.TANYX_API_URL ?? "https://tanyx-api-production.up.railway.app";

interface QuiebreItem {
  id: string;
  title: string;
  stock: number;
  vendido_periodo: number;
  ventas_diarias: number;
  dias_restantes: number | null;
  estado: string;
  en_full: boolean;
}

async function getCredentials(): Promise<{ accessToken: string; userId: string } | null> {
  // 1. Intentar desde cookie de sesión
  const store = await cookies();
  const cookieToken  = store.get("access_token")?.value;
  const cookieUserId = store.get("user_id")?.value;
  if (cookieToken && cookieUserId) return { accessToken: cookieToken, userId: cookieUserId };

  // 2. Refrescar desde env vars
  const clientId     = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  const refreshToken = process.env.ML_REFRESH_TOKEN;
  const userId       = process.env.ML_USER_ID;
  if (!clientId || !clientSecret || !refreshToken || !userId) return null;

  const res = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken }),
    cache: "no-store",
  });
  if (!res.ok) return null;
  const json = await res.json();
  return { accessToken: json.access_token, userId };
}

// ── Fallback: construir quiebre desde el endpoint /kpis existente ────────────
function kpisToQuiebre(kpis: Record<string, unknown>, days: number): QuiebreItem[] {
  const result: QuiebreItem[] = [];
  const seenTitles = new Set<string>();

  type TopProducto = { title: string; ventas_periodo: number; stock: number; en_full?: boolean };
  type StockCritico = { id: string; title: string; available_quantity: number };
  type SinVentas = { id: string; title: string; stock: number };

  // 1. top_productos: velocidad exacta por producto
  for (const p of (kpis.top_productos as TopProducto[] | undefined) ?? []) {
    const daily = p.ventas_periodo / days;
    const diasR = daily > 0 ? p.stock / daily : null;
    let estado: string;
    if (p.stock === 0)       estado = "QUEBRADO";
    else if (diasR === null) estado = "SIN_VENTAS";
    else if (diasR < 7)     estado = "CRITICO";
    else if (diasR < 30)    estado = "RIESGO";
    else                    estado = "OK";

    result.push({ id: p.title, title: p.title, stock: p.stock, vendido_periodo: p.ventas_periodo, ventas_diarias: Math.round(daily * 100) / 100, dias_restantes: diasR !== null ? Math.round(diasR * 10) / 10 : null, estado, en_full: p.en_full ?? false });
    seenTitles.add(p.title);
  }

  // 2. stock_critico no en top_productos: stock bajo (1-15) con alguna venta
  for (const p of (kpis.stock_critico as StockCritico[] | undefined) ?? []) {
    if (seenTitles.has(p.title)) continue;
    result.push({ id: p.id, title: p.title, stock: p.available_quantity, vendido_periodo: 0, ventas_diarias: 0, dias_restantes: null, estado: "CRITICO", en_full: false });
    seenTitles.add(p.title);
  }

  // 3. sin_ventas
  for (const p of (kpis.sin_ventas as SinVentas[] | undefined) ?? []) {
    if (seenTitles.has(p.title)) continue;
    result.push({ id: p.id, title: p.title, stock: p.stock, vendido_periodo: 0, ventas_diarias: 0, dias_restantes: null, estado: "SIN_VENTAS", en_full: false });
    seenTitles.add(p.title);
  }

  const urgencyOrder: Record<string, number> = { QUEBRADO: 0, CRITICO: 1, RIESGO: 2, SIN_VENTAS: 3, OK: 4 };
  return result.sort((a, b) => {
    const diff = (urgencyOrder[a.estado] ?? 9) - (urgencyOrder[b.estado] ?? 9);
    if (diff !== 0) return diff;
    return (a.dias_restantes ?? Infinity) - (b.dias_restantes ?? Infinity);
  });
}

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? "15");

  const creds = await getCredentials();
  if (!creds) {
    return NextResponse.json({ error: "No hay sesión activa y faltan credenciales en env vars." }, { status: 401 });
  }
  const { accessToken, userId } = creds;

  // ── Intentar nuevo endpoint /quiebre ────────────────────────────────────────
  const quiebreUrl = `${TANYX_API}/api/ml/quiebre?access_token=${encodeURIComponent(accessToken)}&user_id=${encodeURIComponent(userId)}&days=${days}`;
  try {
    const res = await fetch(quiebreUrl, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json(data);
    }
    // Si no existe (404) → fallback a /kpis
    if (res.status !== 404) {
      const text = await res.text();
      return NextResponse.json({ error: `TanyxApi error ${res.status}`, details: text }, { status: res.status });
    }
  } catch {
    // red error → intentar fallback
  }

  // ── Fallback: /kpis con rango de `days` días ────────────────────────────────
  const now      = new Date();
  const dateFrom = new Date(Date.now() - days * 86400000).toISOString().split("T")[0];
  const dateTo   = now.toISOString().split("T")[0];
  const kpisUrl  = `${TANYX_API}/api/ml/kpis?access_token=${encodeURIComponent(accessToken)}&user_id=${encodeURIComponent(userId)}&date_from=${dateFrom}&date_to=${dateTo}`;

  try {
    const res = await fetch(kpisUrl, { cache: "no-store" });
    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `TanyxApi kpis error ${res.status}`, details: text }, { status: res.status });
    }
    const kpis = await res.json() as Record<string, unknown>;
    const items = kpisToQuiebre(kpis, days);
    return NextResponse.json(items, { headers: { "X-Source": "kpis-fallback" } });
  } catch (err) {
    return NextResponse.json({ error: "Error al conectar con TanyxApi", details: String(err) }, { status: 500 });
  }
}
