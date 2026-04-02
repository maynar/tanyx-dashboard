import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET() {
  const store = await cookies();
  const access_token = store.get("access_token")?.value ?? null;
  const user_id = store.get("user_id")?.value ?? null;
  return NextResponse.json({ access_token, user_id });
}
