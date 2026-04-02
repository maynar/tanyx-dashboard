import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

function getClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY en las variables de entorno de Vercel.");
  return new Anthropic({ apiKey });
}

interface TopProducto {
  title: string;
  ventas_periodo: number;
  facturacion_periodo: number;
  stock: number;
  precio: number;
}

interface KPIs {
  total_ventas: number;
  facturacion_estimada: number;
  total_visitas: number;
  conversion_rate: number;
  ticket_promedio: number;
  publicaciones_activas: number;
  date_from: string;
  date_to: string;
  top_productos: TopProducto[];
  stock_critico: { title: string; available_quantity: number }[];
  sin_ventas: { title: string; stock: number }[];
}

interface Competidor {
  title: string;
  precio: number;
  vendidos: number;
}

async function buscarCompetidores(token: string, titulo: string): Promise<Competidor[]> {
  try {
    const query = titulo.split(" ").slice(0, 5).join(" ");
    const resp = await fetch(
      `https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(query)}&limit=5`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.results ?? []).map((r: Record<string, unknown>) => ({
      title: r.title as string,
      precio: r.price as number,
      vendidos: (r.sold_quantity as number) ?? 0,
    }));
  } catch {
    return [];
  }
}

function extractJson(text: string): string | null {
  // Strip markdown code fences if present
  const stripped = text.replace(/```(?:json)?\s*/g, "").replace(/```/g, "");
  const first = stripped.indexOf("{");
  const last = stripped.lastIndexOf("}");
  return first !== -1 && last > first ? stripped.slice(first, last + 1) : null;
}

export async function POST(req: Request) {
  try { return await _post(req); }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "server_error", message: msg }, { status: 500 });
  }
}

async function _post(req: Request) {
  const body = await req.json().catch(() => null);
  const kpis: KPIs | undefined = body?.kpis ?? (body?.total_ventas != null ? body : undefined);
  const access_token: string | undefined = body?.access_token;

  if (!kpis) {
    return NextResponse.json({ error: "invalid_body", message: "No se recibieron KPIs." }, { status: 400 });
  }

  // Buscar competidores para top 5 productos en paralelo
  const top5 = kpis.top_productos?.slice(0, 5) ?? [];
  const competidoresMap: Record<string, Competidor[]> = {};

  if (access_token && top5.length > 0) {
    const results = await Promise.all(top5.map(p => buscarCompetidores(access_token, p.title)));
    top5.forEach((p, i) => { competidoresMap[p.title] = results[i]; });
  }

  const competidoresStr = top5.map(p => {
    const comps = competidoresMap[p.title] ?? [];
    if (comps.length === 0) return `- ${p.title}: sin datos de competidores`;
    const precios = comps.map(c => c.precio);
    const precioPromComp = precios.reduce((a, b) => a + b, 0) / precios.length;
    const diff = ((p.precio - precioPromComp) / precioPromComp * 100).toFixed(1);
    const topComp = [...comps].sort((a, b) => b.vendidos - a.vendidos)[0];
    return `- ${p.title}
    Nuestro precio: $${p.precio.toLocaleString()} | Promedio competencia: $${Math.round(precioPromComp).toLocaleString()} (${diff}% ${Number(diff) > 0 ? "más caro" : "más barato"})
    Líder de mercado: "${topComp.title}" — ${topComp.vendidos} vendidos a $${topComp.precio.toLocaleString()}
    Nuestras ventas período: ${p.ventas_periodo} | Stock: ${p.stock}`;
  }).join("\n\n");

  const prompt = `Sos un analista experto en e-commerce y Mercado Libre Argentina.
Analizá estos datos y devolvé SOLO un JSON sin texto adicional:

{
  "alertas": [
    { "tipo": "critica|advertencia|info", "titulo": "...", "descripcion": "...", "accion": "..." }
  ],
  "resumen": "2-3 oraciones sobre estado general y principales oportunidades"
}

PERÍODO: ${kpis.date_from?.slice(0,10)} al ${kpis.date_to?.slice(0,10)}

KPIs:
- Ventas: ${kpis.total_ventas} órdenes | Facturación: $${kpis.facturacion_estimada?.toLocaleString()}
- Visitas: ${kpis.total_visitas} | Conversión: ${kpis.conversion_rate}% | Ticket promedio: $${kpis.ticket_promedio?.toLocaleString()}
- Publicaciones activas: ${kpis.publicaciones_activas} | Stock crítico: ${kpis.stock_critico?.length} | Sin ventas en período: ${kpis.sin_ventas?.length}

TOP 20 PRODUCTOS MÁS VENDIDOS DEL PERÍODO:
${kpis.top_productos?.map((p, i) => `${i+1}. ${p.title} — ${p.ventas_periodo} ventas | $${p.facturacion_periodo?.toLocaleString()} | precio $${p.precio?.toLocaleString()} | stock ${p.stock}`).join("\n")}

COMPARACIÓN CON COMPETIDORES (top 5):
${competidoresStr || "No disponible"}

Generá 5-7 alertas priorizadas sobre:
- Productos top con precio muy diferente al de la competencia (oportunidades de ajuste)
- Productos top en riesgo de quiebre de stock
- Qué hace el líder de mercado que podría replicarse
- Oportunidades para aumentar ventas basadas en la comparación competitiva
- Conversión y ticket vs benchmarks típicos de ML Argentina`;

  const anthropic = getClient();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content.find(b => b.type === "text")?.text ?? "";
  const jsonText = extractJson(text);
  if (!jsonText) {
    return NextResponse.json({ error: "ia_response_parse_error", raw: text }, { status: 500 });
  }

  try {
    return NextResponse.json(JSON.parse(jsonText));
  } catch {
    return NextResponse.json({ error: "ia_response_parse_error", raw: text }, { status: 500 });
  }
}
