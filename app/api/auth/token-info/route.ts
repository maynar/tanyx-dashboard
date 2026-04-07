import { cookies } from "next/headers";
import { NextResponse } from "next/server";

// Endpoint para que el dueño copie el refresh_token a las env vars de Vercel.
// Solo accesible si ya está logueado con ML OAuth.
export async function GET() {
  const store         = await cookies();
  const refreshToken  = store.get("refresh_token")?.value ?? null;
  const userId        = store.get("user_id")?.value ?? null;

  if (!refreshToken || !userId) {
    return NextResponse.json(
      { error: "No hay sesión activa. Iniciá sesión con ML OAuth primero." },
      { status: 401 }
    );
  }

  return NextResponse.json({
    ML_REFRESH_TOKEN: refreshToken,
    ML_USER_ID:       userId,
    instrucciones:    "Copiá estos valores como variables de entorno en Vercel.",
  });
}
