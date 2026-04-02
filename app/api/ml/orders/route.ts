import { cookies } from "next/headers";
import { NextResponse } from "next/server";
export const maxDuration = 60;

function toObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}
function toNum(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") { const n = Number(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}
function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

type OrderItem = { item_id: string; quantity: number; unit_price: number };
type Order = { total_amount: number; items: OrderItem[] };

function parseOrders(j: unknown): Order[] {
  const obj = toObj(j);
  const results = Array.isArray(obj?.results) ? obj.results as unknown[] : [];
  return results.map((o) => {
    const obj2 = toObj(o);
    if (!obj2) return null;
    const orderItems: OrderItem[] = [];
    const rawItems = Array.isArray(obj2.order_items) ? obj2.order_items as unknown[] : [];
    for (const oi of rawItems) {
      const oiObj = toObj(oi);
      if (!oiObj) continue;
      const itemObj = toObj(oiObj.item);
      const itemId = itemObj ? toStr(itemObj.id) : "";
      if (itemId) orderItems.push({
        item_id: itemId,
        quantity: toNum(oiObj.quantity),
        unit_price: toNum(oiObj.unit_price),
      });
    }
    return { total_amount: toNum(obj2.total_amount), items: orderItems };
  }).filter((x): x is Order => Boolean(x));
}

export async function GET(req: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const userId = cookieStore.get("user_id")?.value;
  if (!token || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const h = { Authorization: `Bearer ${token}` };
  const url = new URL(req.url);

  const now = new Date();
  const ago30 = new Date(now);
  ago30.setDate(ago30.getDate() - 30);
  const dateFrom = url.searchParams.get("date_from")
    ? `${url.searchParams.get("date_from")}T00:00:00.000-03:00`
    : ago30.toISOString().replace("Z", "-03:00");
  const dateTo = url.searchParams.get("date_to")
    ? `${url.searchParams.get("date_to")}T23:59:59.000-03:00`
    : now.toISOString().replace("Z", "-03:00");

  try {
    const firstRes = await fetch(
      `https://api.mercadolibre.com/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&limit=50&offset=0`,
      { headers: h }
    );
    const firstJson = await firstRes.json().catch(() => null);
    const ordTotal = toNum(toObj(firstJson)?.paging ? toNum(toObj(toObj(firstJson)?.paging)?.total) : 0);

    const offsets: number[] = [];
    for (let o = 50; o < Math.min(ordTotal, 2000); o += 50) offsets.push(o);

    const extraResults = await Promise.all(
      offsets.map((o) =>
        fetch(
          `https://api.mercadolibre.com/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&limit=50&offset=${o}`,
          { headers: h }
        ).then((r) => r.json()).catch(() => null)
      )
    );

    const allOrders: Order[] = [
      ...parseOrders(firstJson),
      ...extraResults.flatMap((j) => parseOrders(j)),
    ];

    return NextResponse.json({ allOrders, total: allOrders.length, dateFrom, dateTo });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}