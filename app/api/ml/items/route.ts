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

export async function GET() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token")?.value;
  const userId = cookieStore.get("user_id")?.value;
  if (!token || !userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const h = { Authorization: `Bearer ${token}` };

  try {
    const firstSearch = await fetch(
      `https://api.mercadolibre.com/users/${userId}/items/search?status=active&limit=50&offset=0`,
      { headers: h }
    );
    const firstJson = toObj(await firstSearch.json().catch(() => null));
    const itemTotal = toNum(toObj(firstJson?.paging)?.total);
    const firstIds = Array.isArray(firstJson?.results)
      ? (firstJson.results as unknown[]).map((x) => typeof x === "string" ? x : "").filter(Boolean)
      : [];

    const offsets: number[] = [];
    for (let o = 50; o < Math.min(itemTotal, 500); o += 50) offsets.push(o);

    const extraIds = await Promise.all(
      offsets.map((o) =>
        fetch(`https://api.mercadolibre.com/users/${userId}/items/search?status=active&limit=50&offset=${o}`, { headers: h })
          .then((r) => r.json()).catch(() => null)
          .then((j) => {
            const obj = toObj(j);
            return Array.isArray(obj?.results)
              ? (obj.results as unknown[]).map((x) => typeof x === "string" ? x : "").filter(Boolean)
              : [];
          })
      )
    );
    const allIds = [...firstIds, ...extraIds.flat()];

    const chunks: string[][] = [];
    for (let i = 0; i < allIds.length; i += 20) chunks.push(allIds.slice(i, i + 20));

    const itemDetails = await Promise.all(
      chunks.map((chunk) =>
        fetch(`https://api.mercadolibre.com/items?ids=${chunk.join(",")}`, { headers: h })
          .then((r) => r.json()).catch(() => [])
      )
    );

    const activeItems = [];
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

    return NextResponse.json({ activeItems, allIds });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}