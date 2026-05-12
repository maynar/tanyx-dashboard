"use client";
import { useEffect, useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface KPIs {
  total_ventas: number;
  facturacion_estimada: number;
  facturacion_sin_iva: number;
  total_visitas: number;
  conversion_rate: number;
  ticket_promedio: number;
  publicaciones_activas: number;
  date_from: string;
  date_to: string;
  stock_critico: { n: number; title: string; available_quantity: number; id: string }[];
  sin_ventas: { n: number; title: string; id: string; stock: number; en_full: boolean }[];
  ventas_por_categoria: { category_id: string; nombre: string; ventas: number; facturacion: number }[];
  top_productos: { title: string; sku?: string; en_full: boolean; ventas_normal: number; ventas_premium: number; ventas_premium_cuotas: number; ventas_periodo: number; facturacion_periodo: number; stock: number; precio: number }[];
}

const RAILWAY_URL = "https://tanyx-api-production.up.railway.app";

function fmt(n: number) {
  return n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtMoney(n: number) {
  return "$" + n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function fmtDate(iso: string) {
  const d = iso.slice(0, 10).split("-");
  return `${d[2]}/${d[1]}/${d[0]}`;
}

export default function Dashboard() {
  const today = new Date().toISOString().split("T")[0];
  const ago30 = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];

  const [dateFrom, setDateFrom] = useState(ago30);
  const [dateTo, setDateTo] = useState(today);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [stockPage, setStockPage] = useState(0);
  const [topPage, setTopPage] = useState(0);
  const [sinVentasPage, setSinVentasPage] = useState(0);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const STOCK_PAGE_SIZE = 10;
  const PAGE_SIZE = 20;
  const TOP_PAGE_SIZE = 50;
  const [topOrden, setTopOrden] = useState<"ventas" | "facturacion">("facturacion");
  const [topSinCuotas, setTopSinCuotas] = useState(false);
  const [topStockCritico, setTopStockCritico] = useState(false);
  const [topSinFull, setTopSinFull] = useState(false);
  const [topSearch, setTopSearch] = useState("");
  const [alerts, setAlerts] = useState<{ tipo: string; titulo: string; descripcion: string; accion: string }[]>([]);
  const [resumen, setResumen] = useState("");

  const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

  function cacheKey(user_id: string, from: string, to: string) {
    return `tanyx_kpis_${user_id}_${from}_${to}`;
  }

  function readCache(key: string): KPIs | null {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const { data, ts } = JSON.parse(raw);
      if (Date.now() - ts > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
      return data as KPIs;
    } catch { return null; }
  }

  function writeCache(key: string, data: KPIs) {
    try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now() })); } catch {}
  }

  function clearCache(key: string) {
    try { localStorage.removeItem(key); } catch {}
  }

  async function getCredentials() {
    const r = await fetch("/api/auth/credentials");
    return r.json();
  }

  async function loadKpis(from: string, to: string, forceRefresh = false) {
    setLoading(true);
    setError("");
    try {
      const { access_token, user_id } = await getCredentials();
      if (!access_token || !user_id) {
        setError("Sesión expirada. Renovar token.");
        return;
      }
      const key = cacheKey(user_id, from, to);
      if (!forceRefresh) {
        const cached = readCache(key);
        if (cached) {
          setKpis(cached);
          setStockPage(0);
          setLoading(false);
          try {
            const raw = localStorage.getItem(key);
            if (raw) {
              const ts = JSON.parse(raw).ts;
              setCachedAt(new Date(ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
            }
          } catch {}
          return;
        }
      } else {
        clearCache(key);
        await fetch(`${RAILWAY_URL}/api/ml/cache?user_id=${user_id}&date_from=${from}&date_to=${to}`, { method: "DELETE" });
      }
      const r = await fetch(
        `${RAILWAY_URL}/api/ml/kpis?user_id=${user_id}&access_token=${access_token}&date_from=${from}&date_to=${to}`
      );
      const data = await r.json();
      if (data.error) { setError(data.error); return; }
      writeCache(key, data);
      setKpis(data);
      setStockPage(0);
      setCachedAt(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError("Error cargando datos: " + msg);
    } finally {
      setLoading(false);
    }
  }

  async function analyze() {
    if (!kpis) return;
    setAnalyzing(true);
    try {
      const { access_token } = await getCredentials();
      const r = await fetch("/api/claude/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kpis, access_token }),
      });
      const text = await r.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); } catch { setError("Error IA: respuesta inválida — " + text.slice(0, 200)); return; }
      if (data.error) { setError("Error IA: " + (data.message ?? data.error)); return; }
      if (data.alertas) setAlerts(data.alertas as typeof alerts);
      if (data.resumen) setResumen(data.resumen as string);
    } catch (e) {
      setError("Error analizando con IA: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setAnalyzing(false);
    }
  }

  useEffect(() => { loadKpis(dateFrom, dateTo); }, []);

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: 1100, margin: "0 auto", padding: "20px" }}>
      <h1 style={{ fontSize: 22, fontWeight: 600, marginBottom: 4 }}>Tanyx — Dashboard ML</h1>
      <p style={{ color: "#666", marginBottom: 20 }}>KPIs de Mercado Libre con análisis por IA</p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 24, flexWrap: "wrap" }}>
        <div>
          <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 4 }}>Desde</label>
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }} />
        </div>
        <div>
          <label style={{ fontSize: 13, color: "#666", display: "block", marginBottom: 4 }}>Hasta</label>
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{ padding: "6px 10px", border: "1px solid #ddd", borderRadius: 6, fontSize: 14 }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 20 }}>
          <button onClick={() => loadKpis(dateFrom, dateTo, true)}
            style={{ padding: "8px 20px", background: "#3483FA", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
            Actualizar datos
          </button>
          {cachedAt && <div style={{ fontSize: 11, color: "#aaa", marginTop: 3 }}>datos de las {cachedAt}</div>}
        </div>
        <button onClick={analyze} disabled={analyzing || !kpis}
          style={{ marginTop: 20, padding: "8px 20px", background: analyzing ? "#ccc" : "#00a650", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
          {analyzing ? "Analizando..." : "Analizar con IA"}
        </button>
        <a href="/stock-agent"
          style={{ marginTop: 20, padding: "8px 20px", background: "#1e293b", color: "white", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14, textDecoration: "none", display: "flex", alignItems: "center", gap: 6 }}>
          🚨 Quiebre de stock
        </a>
        <a href="/"
          style={{ marginTop: 20, padding: "8px 20px", background: "#f5f5f5", color: "#333", border: "1px solid #ddd", borderRadius: 6, cursor: "pointer", fontSize: 14, textDecoration: "none" }}>
          Renovar sesión
        </a>
      </div>

      {error && (
        <div style={{ background: "#fff0f0", color: "#cc0000", padding: "10px 16px", borderRadius: 8, marginBottom: 16 }}>
          {error} {error.includes("expirada") && <a href="/" style={{ color: "#cc0000", fontWeight: 600 }}>→ Renovar acá</a>}
        </div>
      )}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 60, gap: 16 }}>
          <div style={{
            width: 40, height: 40, border: "4px solid #eee",
            borderTop: "4px solid #3483FA", borderRadius: "50%",
            animation: "spin 0.8s linear infinite"
          }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          <div style={{ color: "#666", fontSize: 15 }}>Trayendo datos, espere…</div>
        </div>
      )}

      {!loading && kpis && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
            {[
              { label: "Ventas en período", value: fmt(kpis.total_ventas) },
              { label: "Facturación bruta", value: fmtMoney(kpis.facturacion_estimada) },
              { label: "Facturación sin IVA", value: fmtMoney(kpis.facturacion_sin_iva) },
              { label: "Visitas", value: fmt(kpis.total_visitas) },
              { label: "Conversión", value: kpis.conversion_rate.toFixed(2) + "%" },
              { label: "Ticket promedio", value: fmtMoney(kpis.ticket_promedio) },
              { label: "Publicaciones activas", value: fmt(kpis.publicaciones_activas) },
            ].map((k) => (
              <div key={k.label} style={{ background: "#f8f8f8", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>{k.label}</div>
                <div style={{ fontSize: 22, fontWeight: 600 }}>{k.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 24 }}>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>Top 40 más vendidos del período</div>
              <div style={{ background: "#f4f6fa", border: "1px solid #e2e6f0", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ position: "relative" }}>
                  <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "#aaa", pointerEvents: "none" }} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input
                    type="text"
                    placeholder="Buscar por nombre o SKU..."
                    value={topSearch}
                    onChange={e => { setTopSearch(e.target.value); setTopPage(0); }}
                    style={{ width: "100%", padding: "8px 12px 8px 32px", fontSize: 13, border: "1px solid #d0d7e6", borderRadius: 8, outline: "none", background: "white", boxSizing: "border-box" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Orden:</span>
                  <button onClick={() => setTopOrden("ventas")}
                    style={{ padding: "5px 14px", fontSize: 12, border: `1.5px solid ${topOrden === "ventas" ? "#3483FA" : "#ddd"}`, borderRadius: 6, cursor: "pointer", background: topOrden === "ventas" ? "#3483FA" : "white", color: topOrden === "ventas" ? "white" : "#555", fontWeight: topOrden === "ventas" ? 600 : 400 }}>
                    Ventas
                  </button>
                  <button onClick={() => setTopOrden("facturacion")}
                    style={{ padding: "5px 14px", fontSize: 12, border: `1.5px solid ${topOrden === "facturacion" ? "#3483FA" : "#ddd"}`, borderRadius: 6, cursor: "pointer", background: topOrden === "facturacion" ? "#3483FA" : "white", color: topOrden === "facturacion" ? "white" : "#555", fontWeight: topOrden === "facturacion" ? 600 : 400 }}>
                    Facturación
                  </button>
                  <div style={{ width: 1, background: "#d0d7e6", alignSelf: "stretch", margin: "0 2px" }} />
                  <span style={{ fontSize: 11, color: "#888", whiteSpace: "nowrap", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>Filtros:</span>
                  <button onClick={() => { setTopSinCuotas(v => !v); setTopPage(0); }}
                    style={{ padding: "5px 12px", fontSize: 12, border: `1.5px solid ${topSinCuotas ? "#e67e00" : "#ddd"}`, borderRadius: 6, cursor: "pointer", background: topSinCuotas ? "#fff4e6" : "white", color: topSinCuotas ? "#c96800" : "#555", fontWeight: topSinCuotas ? 600 : 400 }}>
                    {topSinCuotas ? "✕ " : ""}Sin cuotas
                  </button>
                  <button onClick={() => { setTopStockCritico(v => !v); setTopPage(0); }}
                    style={{ padding: "5px 12px", fontSize: 12, border: `1.5px solid ${topStockCritico ? "#cc0000" : "#ddd"}`, borderRadius: 6, cursor: "pointer", background: topStockCritico ? "#fff0f0" : "white", color: topStockCritico ? "#cc0000" : "#555", fontWeight: topStockCritico ? 600 : 400 }}>
                    {topStockCritico ? "✕ " : ""}Stock crítico
                  </button>
                  <button onClick={() => { setTopSinFull(v => !v); setTopPage(0); }}
                    style={{ padding: "5px 12px", fontSize: 12, border: `1.5px solid ${topSinFull ? "#6f42c1" : "#ddd"}`, borderRadius: 6, cursor: "pointer", background: topSinFull ? "#f5f0ff" : "white", color: topSinFull ? "#6f42c1" : "#555", fontWeight: topSinFull ? 600 : 400 }}>
                    {topSinFull ? "✕ " : ""}Sin Full
                  </button>
                </div>
              </div>
            </div>
            {(() => {
              const searchLower = topSearch.toLowerCase();
              const filtered = kpis.top_productos
                .filter(p => !topSearch || p.title.toLowerCase().includes(searchLower) || (p.sku ?? "").toLowerCase().includes(searchLower))
                .filter(p => !topSinCuotas || p.ventas_premium_cuotas === 0)
                .filter(p => !topStockCritico || (p.stock > 0 && p.stock <= 15))
                .filter(p => !topSinFull || !p.en_full);
              const sorted = [...filtered].sort((a, b) =>
                topOrden === "facturacion" ? b.facturacion_periodo - a.facturacion_periodo : b.ventas_periodo - a.ventas_periodo);
              const totalPages = Math.ceil(sorted.length / TOP_PAGE_SIZE);
              const page = sorted.slice(topPage * TOP_PAGE_SIZE, (topPage + 1) * TOP_PAGE_SIZE);
              return <>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "#f8f8f8" }}>
                      <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>#</th>
                      <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #eee" }}>Producto</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee", color: "#555" }}>Clásica</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee", color: "#0056b3" }}>Cuotas</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee", fontWeight: 700 }}>Total</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee" }}>Stock</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee" }}>Precio</th>
                      <th style={{ padding: "8px 10px", textAlign: "right", borderBottom: "1px solid #eee" }}>Facturación</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((p, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ padding: "8px 10px", color: "#888" }}>{topPage * TOP_PAGE_SIZE + i + 1}</td>
                        <td style={{ padding: "8px 10px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            <span>{p.title}</span>
                            {p.en_full && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#00a650", color: "white", fontWeight: 600, whiteSpace: "nowrap" }}>Full</span>}
                          </div>
                          {p.sku && <div style={{ fontSize: 11, color: "#aaa", marginTop: 1 }}>SKU: {p.sku}</div>}
                        </td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: p.ventas_premium > 0 ? "#856404" : "#ccc" }}>{p.ventas_premium > 0 ? fmt(p.ventas_premium) : "—"}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", color: p.ventas_premium_cuotas > 0 ? "#0056b3" : "#ccc" }}>{p.ventas_premium_cuotas > 0 ? fmt(p.ventas_premium_cuotas) : "—"}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>{fmt(p.ventas_periodo)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmt(p.stock)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(p.precio)}</td>
                        <td style={{ padding: "8px 10px", textAlign: "right" }}>{fmtMoney(p.facturacion_periodo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 13 }}>
                    <button onClick={() => setTopPage(p => p - 1)} disabled={topPage === 0}
                      style={{ padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, cursor: topPage === 0 ? "default" : "pointer", background: topPage === 0 ? "#f5f5f5" : "white" }}>←</button>
                    <span style={{ color: "#888" }}>{topPage + 1} / {totalPages}</span>
                    <button onClick={() => setTopPage(p => p + 1)} disabled={topPage + 1 >= totalPages}
                      style={{ padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, cursor: topPage + 1 >= totalPages ? "default" : "pointer", background: topPage + 1 >= totalPages ? "#f5f5f5" : "white" }}>→</button>
                  </div>
                )}
                <div style={{ fontSize: 12, color: "#aaa", marginTop: 8, textAlign: "right" }}>
                  {sorted.length} productos · ordenado por {topOrden === "facturacion" ? "facturación" : "unidades vendidas"}
                </div>
              </>;
            })()}
          </div>

          {kpis.ventas_por_categoria?.length > 0 && (() => {
            const COLORS = ["#3483FA","#00a650","#e67e00","#cc0000","#6f42c1","#17a2b8","#fd7e14","#20c997","#e83e8c","#6c757d"];
            const data = kpis.ventas_por_categoria.slice(0, 10);
            return (
              <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 16, marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 16 }}>Ventas por categoría</div>
                <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
                  <ResponsiveContainer width={300} height={280}>
                    <PieChart>
                      <Pie data={data} dataKey="facturacion" nameKey="nombre" cx="50%" cy="50%" outerRadius={110} innerRadius={55}>
                        {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmtMoney(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    {data.map((c, i) => (
                      <div key={c.category_id} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13 }}>
                        <div style={{ width: 12, height: 12, borderRadius: 3, background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                        <span style={{ flex: 1, color: "#333" }}>{c.nombre}</span>
                        <span style={{ color: "#888", whiteSpace: "nowrap" }}>{fmt(c.ventas)} u.</span>
                        <span style={{ fontWeight: 600, whiteSpace: "nowrap", minWidth: 100, textAlign: "right" }}>{fmtMoney(c.facturacion)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16, marginBottom: 24 }}>
            <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Con stock sin ventas en el período ({kpis.sin_ventas.length})</div>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 10 }}>Activas con stock que no vendieron entre {fmtDate(kpis.date_from)} y {fmtDate(kpis.date_to)}</div>
              {kpis.sin_ventas.length === 0
                ? <div style={{ color: "#888", fontSize: 13 }}>Ninguna</div>
                : <>
                  {kpis.sin_ventas.slice(sinVentasPage * PAGE_SIZE, (sinVentasPage + 1) * PAGE_SIZE).map((p) => (
                    <div key={p.id} style={{ fontSize: 13, padding: "6px 0", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span><strong>{p.n}.</strong> {p.title}{p.en_full && <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, background: "#00a650", color: "white", fontWeight: 600, marginLeft: 6 }}>Full</span>}</span>
                      <span style={{ color: "#888", whiteSpace: "nowrap", marginLeft: 8 }}>{p.stock} u.</span>
                    </div>
                  ))}
                  {kpis.sin_ventas.length > PAGE_SIZE && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 13 }}>
                      <button onClick={() => setSinVentasPage(p => p - 1)} disabled={sinVentasPage === 0}
                        style={{ padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, cursor: sinVentasPage === 0 ? "default" : "pointer", background: sinVentasPage === 0 ? "#f5f5f5" : "white" }}>←</button>
                      <span style={{ color: "#888" }}>{sinVentasPage + 1} / {Math.ceil(kpis.sin_ventas.length / PAGE_SIZE)}</span>
                      <button onClick={() => setSinVentasPage(p => p + 1)} disabled={(sinVentasPage + 1) * PAGE_SIZE >= kpis.sin_ventas.length}
                        style={{ padding: "4px 12px", border: "1px solid #ddd", borderRadius: 6, cursor: (sinVentasPage + 1) * PAGE_SIZE >= kpis.sin_ventas.length ? "default" : "pointer", background: (sinVentasPage + 1) * PAGE_SIZE >= kpis.sin_ventas.length ? "#f5f5f5" : "white" }}>→</button>
                    </div>
                  )}
                </>
              }
            </div>
          </div>

          {(alerts.length > 0 || resumen) && (
            <div style={{ background: "white", border: "1px solid #eee", borderRadius: 10, padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 12 }}>Análisis IA</div>
              {resumen && <p style={{ fontSize: 14, color: "#444", marginBottom: 16, lineHeight: 1.6 }}>{resumen}</p>}
              {alerts.map((a, i) => (
                <div key={i} style={{
                  padding: "10px 14px", borderRadius: 8, marginBottom: 8,
                  background: a.tipo === "critica" ? "#fff0f0" : a.tipo === "advertencia" ? "#fffbf0" : "#f0f7ff",
                  borderLeft: `4px solid ${a.tipo === "critica" ? "#cc0000" : a.tipo === "advertencia" ? "#e67e00" : "#3483FA"}`
                }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{a.titulo}</div>
                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{a.descripcion}</div>
                  <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>Acción: {a.accion}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}