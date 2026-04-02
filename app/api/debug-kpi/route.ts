import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token")?.value;
  const userId = cookieStore.get("user_id")?.value;

  if (!accessToken || !userId) {
    return NextResponse.json({ error: "sin sesión" }, { status: 401 });
  }

  const h = { Authorization: `Bearer ${accessToken}` };

  const searchRes = await fetch(
    `https://api.mercadolibre.com/users/${userId}/items/search?status=active&limit=5`,
    { headers: h }
  );
  const searchJson = await searchRes.json();

  const ids = (searchJson?.results ?? []).slice(0, 3).join(",");
  let detailJson = null;
  if (ids) {
    const detailRes = await fetch(
      `https://api.mercadolibre.com/items?ids=${ids}`,
      { headers: h }
    );
    detailJson = await detailRes.json();
  }

  return NextResponse.json({ searchJson, detailJson, userId });
}