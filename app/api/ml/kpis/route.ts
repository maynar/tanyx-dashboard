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
    // Llamadas iniciales en paralelo
    const [searchRes, ordersRes] = await Promise.all([
      fetch(`https://api.mercadolibre.com/users/${userId}/items/search?status=active&limit=50&offset=0`, { headers: h }),
      fetch(`https://api.mercadolibre.com/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&limit=50&offset=0`, { headers: h }),
    ]);

    const [searchJson, ordersJson] = await Promise.all([
      searchRes.json().catch(() => null),
      ordersRes.json().catch(() => null),
    ]);

    const itemTotal = toNum(toObj(toObj(searchJson)?.paging)?.total);
    const ordTotal = toNum(toObj(toObj(ordersJson)?.paging)?.total);

    const firstIds = Array.isArray(toObj(searchJson)?.results)
      ? (toObj(searchJson)!.results as unknown[]).map((x) => typeof x === "string" ? x : "").filter(Boolean)
      : [];

    // Offsets para items (max 100) y órdenes (max 500) en paralelo
    const itemOffsets: number[] = [];
    for (let o = 50; o < Math.min(itemTotal, 100); o += 50) itemOffsets.push(o);

    const ordOffsets: number[] = [];
    for (let o = 50; o < Math.min(ordTotal, 500); o += 50) ordOffsets.push(o);

    const [extraItemPages, extraOrdPages] = await Promise.all([
      Promise.all(itemOffsets.map((o) =>
        fetch(`https://api.mercadolibre.com/users/${userId}/items/search?status=active&limit=50&offset=${o}`, { headers: h })
          .then((r) => r.json()).catch(() => null)
      )),
      Promise.all(ordOffsets.map((o) =>
        fetch(`https://api.mercadolibre.com/orders/search?seller=${userId}&order.status=paid&order.date_created.from=${encodeURIComponent(dateFrom)}&order.date_created.to=${encodeURIComponent(dateTo)}&limit=50&offset=${o}`, { headers: h })
          .then((r) => r.json()).catch(() => null)
      )),
    ]);

    const allIds = [
      ...firstIds,
      ...extraItemPages.flatMap((j) => {
        const obj = toObj(j);
        return Array.isArray(obj?.results)
          ? (obj!.results as unknown[]).map((x) => typeof x === "string" ? x : "").filter(Boolean)
          : [];
      }),
    ];

    // Detalles de items en paralelo
    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += 20) chunks.push(allIds.slice(i, i + 20));
    const itemDetails = await Promise.all(
      chunks.map((chunk) =>
        fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(",")}`, { headers: h })
          .then((r) => r.json()).catch(() => [])
      )
    );

    type Item = { id: string; title: string; sold_quantity: number; available_quantity: number; price: number };
    const activeItems: Item[] = [];
    for (const arr of itemDetails) {
      if (!Array.isArray(arr)) continue;
      for (const entry of arr) {
        const wrapper = toObj(entry);
        if (!wrapper || toNum(wrapper.code) === 404) continue;
        const item = toObj(wrapper.body) ?? wrapper;
        const id = toStr(item.id);
        if (!id) continue;
        activeItems.push({
          id,
          title: toStr(item.title) || id,
          sold_quantity: toNum(item.sold_quantity),
          available_quantity: toNum(item.available_quantity),
          price: toNum(item.price),
        });
      }
    }

    // Parsear órdenes
    type OrderItem = { item_id: string; quantity: number; unit_price: number };
    type Order = { total_amount: number; items: OrderItem[] };

    function parseOrders(j: unknown): Order[] {
      const obj = toObj(j);
      const results = Array.isArray(obj?.results) ? obj!.results as unknown[] : [];
      return results.flatMap((o) => {
        const obj2 = toObj(o);
        if (!obj2) return [];
        const orderItems: OrderItem[] = [];
        const rawItems = Array.isArray(obj2.order_items) ? obj2.order_items as unknown[] : [];
        for (const oi of rawItems) {
          const oiObj = toObj(oi);
          if (!oiObj) continue;
          const itemId = toStr(toObj(oiObj.item)?.id);
          if (itemId) orderItems.push({ item_id: itemId, quantity: toNum(oiObj.quantity), unit_price: toNum(oiObj.unit_price) });
        }
        return [{ total_amount: toNum(obj2.total_amount), items: orderItems }];
      });
    }

    const allOrders: Order[] = [
      ...parseOrders(ordersJson),
      ...extraOrdPages.flatMap((j) => parseOrders(j)),
    ];

    // Visitas
    let total_visitas = 0;
    if (allIds.length > 0) {
      const vRes = await fetch(`https://api.mercadolibre.com/visits/items?ids=${allIds.slice(0, 50).join(",")}`, { headers: h });
      const vJson = await vRes.json().catch(() => null);
      if (vJson && typeof vJson === "object" && !Array.isArray(vJson)) {
        total_visitas = Object.values(vJson as Record<string, unknown>).reduce<number>((s, v) => s + toNum(v), 0);
      }
    }

    // Ventas por item en el período
    const salesByItem: Record<string, { quantity: number; revenue: number }> = {};
    for (const order of allOrders) {
      for (const oi of order.items) {
        if (!salesByItem[oi.item_id]) salesByItem[oi.item_id] = { quantity: 0, revenue: 0 };
        salesByItem[oi.item_id].quantity += oi.quantity;
        salesByItem[oi.item_id].revenue += oi.quantity * oi.unit_price;
      }
    }

    const total_ventas = allOrders.length;
    const facturacion_estimada = allOrders.reduce((s, o) => s + o.total_amount, 0);
    const ticket_promedio = total_ventas > 0 ? facturacion_estimada / total_ventas : 0;
    const conversion_rate = total_visitas > 0 ? (total_ventas / total_visitas) * 100 : 0;

    const itemMap = new Map(activeItems.map((i) => [i.id, i]));
    const topProductos = Object.entries(salesByItem)
      .map(([id, s]) => {
        const item = itemMap.get(id);
        return {
          title: item?.title ?? id,
          ventas_periodo: s.quantity,
          facturacion_periodo: s.revenue,
          stock: item?.available_quantity ?? 0,
          precio: item?.price ?? 0,
          ventas_historicas: item?.sold_quantity ?? 0,
        };
      })
      .sort((a, b) => b.ventas_periodo - a.ventas_periodo)
      .slice(0, 10);

    return NextResponse.json({
      total_ventas,
      facturacion_estimada,
      total_visitas,
      conversion_rate,
      ticket_promedio,
      publicaciones_activas: itemTotal,
      date_from: dateFrom,
      date_to: dateTo,
      stock_critico: activeItems
        .filter((p) => p.available_quantity > 0 && p.available_quantity <= 5)
        .map((p, i) => ({ n: i + 1, title: p.title, available_quantity: p.available_quantity, id: p.id })),
      sin_ventas: activeItems
        .filter((p) => p.sold_quantity === 0)
        .map((p, i) => ({ n: i + 1, title: p.title, id: p.id })),
      top_productos: topProductos,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}