import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export const maxDuration = 60;

function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  if (!token) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const h = { Authorization: `Bearer ${token}` };
  const url = new URL(req.url);
  const ids = url.searchParams.get("ids");
  if (!ids) return NextResponse.json({ error: "falta ids" }, { status: 400 });

  try {
    const r = await fetch(
      `https://api.mercadolibre.com/visits/items?ids=${ids}`,
      { headers: h }
    );
    const j = await r.json().catch(() => null);
    let total_visitas = 0;
    if (j && typeof j === "object" && !Array.isArray(j)) {
      total_visitas = Object.values(j as Record<string, unknown>)
        .reduce<number>((s, v) => s + toNum(v), 0);
    }
    return NextResponse.json({ total_visitas, detalle: j });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}