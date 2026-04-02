export interface KPIs {
  total_ventas: number;
  facturacion_estimada: number;
  total_visitas: number;
  conversion_rate: number;
  ticket_promedio: number;
  publicaciones_activas: number;
  sin_ventas: string[];
  stock_critico: Array<{ title: string; available_quantity: number; id: string }>;
  top_productos: Array<{ title: string; ventas: number; facturacion: number }>;
}

type RecordUnknown = Record<string, unknown>;

function toRecordUnknown(value: unknown): RecordUnknown | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as RecordUnknown;
  }
  return null;
}

function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function parseMoney(value: unknown): number {
  // Mercado Libre suele devolver: { amount: number, currency_id: string }
  if (value && typeof value === "object") {
    const record = toRecordUnknown(value);
    const maybeAmount = record?.amount ?? record?.value;
    return parseNumber(maybeAmount);
  }
  return parseNumber(value);
}

function pickTitle(item: unknown): string {
  const obj = toRecordUnknown(item);
  const title = obj ? getString(obj["title"]) : null;
  const name = obj ? getString(obj["name"]) : null;
  const attributes = obj ? toRecordUnknown(obj["attributes"]) : null;
  const attributesTitle = attributes ? getString(attributes["title"]) : null;
  const idString = obj ? getString(obj["id"]) : null;

  return title ?? name ?? attributesTitle ?? idString ?? "Producto";
}

function pickItemId(item: unknown): string | null {
  const obj = toRecordUnknown(item);
  const id = obj ? obj["id"] ?? obj["item_id"] ?? obj["itemId"] : undefined;
  if (typeof id === "string" && id.length > 0) return id;
  if (typeof id === "number") return String(id);
  return null;
}

export async function fetchActiveItems(
  accessToken: string,
  userId: string,
  limit = 50
): Promise<
  Array<{
    id: string;
    title: string;
    sold_quantity: number;
    available_quantity: number;
  }>
> {
  const url = `https://api.mercadolibre.com/users/${encodeURIComponent(
    userId
  )}/items/search?status=active&limit=${encodeURIComponent(String(limit))}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`ML items/search falló: ${res.status}`);

  const data = await res.json();
  const results: unknown[] = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.body?.results)
      ? data.body.results
      : Array.isArray(data)
        ? data
        : [];

  return results
    .map((item: unknown) => {
      const id = pickItemId(item);
      if (!id) return null;

      const obj = toRecordUnknown(item);
      const metrics = obj ? toRecordUnknown(obj["metrics"]) : null;

      return {
        id,
        title: pickTitle(item),
        sold_quantity: parseNumber(
          (obj?.["sold_quantity"] ??
            obj?.["soldQuantity"] ??
            metrics?.["sold_quantity"]) as unknown
        ),
        available_quantity: parseNumber(
          (obj?.["available_quantity"] ??
            obj?.["availableQuantity"] ??
            metrics?.["available_quantity"]) as unknown
        ),
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

export async function fetchPaidOrders(
  accessToken: string,
  userId: string,
  limit = 50
): Promise<
  Array<{
    total_amount: number;
  }>
> {
  const url = `https://api.mercadolibre.com/orders/search?seller=${encodeURIComponent(
    userId
  )}&order.status=paid&limit=${encodeURIComponent(String(limit))}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`ML orders/search falló: ${res.status}`);

  const data = await res.json();
  const results: unknown[] = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.body?.results)
      ? data.body.results
      : Array.isArray(data)
        ? data
        : [];

  return (results as unknown[]).map((order: unknown) => {
    const obj = toRecordUnknown(order);
    const candidate = obj?.["total_amount"] ?? obj?.["totalAmount"] ?? order;
    return { total_amount: parseMoney(candidate) };
  });
}

export async function fetchVisitsForItemIds(
  accessToken: string,
  itemIds: string[]
): Promise<Record<string, number>> {
  if (itemIds.length === 0) return {};
  const ids = itemIds.join(",");
  const url = `https://api.mercadolibre.com/visits/items?ids=${encodeURIComponent(
    ids
  )}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`ML visits/items falló: ${res.status}`);

  const data = await res.json();
  const results: unknown[] = Array.isArray(data?.results)
    ? data.results
    : Array.isArray(data?.body?.results)
      ? data.body.results
      : Array.isArray(data)
        ? data
        : [];

  const map: Record<string, number> = {};
  for (const entry of results as unknown[]) {
    const idFromPrimary = pickItemId(entry);
    const obj = toRecordUnknown(entry);
    const candidate = obj?.["item_id"] ?? obj?.["id"];
    const id =
      idFromPrimary ??
      (typeof candidate === "string" ? candidate : null) ??
      (typeof candidate === "number" ? String(candidate) : null);
    if (typeof id !== "string" || id.length === 0) continue;

    const visitsValue =
      parseNumber(obj?.["total"]) ||
      parseNumber(obj?.["visits"]) ||
      parseNumber(obj?.["quantity"]) ||
      parseNumber(obj?.["amount"]) ||
      parseNumber(obj?.["value"]);

    map[id] = visitsValue;
  }
  return map;
}

export function buildKPIs(params: {
  activeItems: Array<{
    id: string;
    title: string;
    sold_quantity: number;
    available_quantity: number;
  }>;
  paidOrders: Array<{ total_amount: number }>;
  visitsByItemId: Record<string, number>;
}): KPIs {
  const { activeItems, paidOrders, visitsByItemId } = params;

  const publicaciones_activas = activeItems.length;

  const total_ventas = paidOrders.length;
  const facturacion_estimada = paidOrders.reduce(
    (sum, o) => sum + (Number.isFinite(o.total_amount) ? o.total_amount : 0),
    0
  );

  const total_visitas = Object.values(visitsByItemId).reduce(
    (sum, v) => sum + (Number.isFinite(v) ? v : 0),
    0
  );

  const conversion_rate =
    total_visitas > 0 ? total_ventas / total_visitas : 0;
  const ticket_promedio =
    total_ventas > 0 ? facturacion_estimada / total_ventas : 0;

  const sin_ventas = activeItems
    .filter((p) => p.sold_quantity <= 0)
    .map((p) => p.title);

  const stock_critico = activeItems
    .filter((p) => p.available_quantity > 0 && p.available_quantity <= 5)
    .map((p) => ({
      title: p.title,
      available_quantity: p.available_quantity,
      id: p.id,
    }));

  const top_productos = [...activeItems]
    .sort((a, b) => b.sold_quantity - a.sold_quantity)
    .slice(0, 5)
    .map((p) => ({
      title: p.title,
      ventas: p.sold_quantity,
      facturacion: p.sold_quantity > 0 ? p.sold_quantity * ticket_promedio : 0,
    }));

  return {
    total_ventas,
    facturacion_estimada,
    total_visitas,
    conversion_rate,
    ticket_promedio,
    publicaciones_activas,
    sin_ventas,
    stock_critico,
    top_productos,
  };
}
