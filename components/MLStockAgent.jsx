"use client";
import { useState, useCallback } from "react";

// ─── CONSTANTES ────────────────────────────────────────────────────────────────
const ESTADO_ORDER   = { QUEBRADO: 0, CRITICO: 1, RIESGO: 2, SIN_VENTAS: 3, OK: 4 };
const ESTADO_LABEL   = { QUEBRADO: "QUEBRADO", CRITICO: "CRÍTICO", RIESGO: "RIESGO", SIN_VENTAS: "SIN VENTAS", OK: "OK" };
const ESTADO_COLOR   = { QUEBRADO: "#dc2626", CRITICO: "#ea580c", RIESGO: "#d97706", SIN_VENTAS: "#6b7280", OK: "#16a34a" };
const ESTADO_BG      = { QUEBRADO: "#fef2f2", CRITICO: "#fff7ed", RIESGO: "#fffbeb", SIN_VENTAS: "#f9fafb", OK: "#f0fdf4" };
const ESTADO_ICON    = { QUEBRADO: "🔴", CRITICO: "🟠", RIESGO: "🟡", SIN_VENTAS: "⚪", OK: "🟢" };

// ─── HELPERS ───────────────────────────────────────────────────────────────────
function fmtDias(dias) {
  if (dias === null || dias === undefined) return "∞";
  if (dias === 0) return "—";
  return dias.toFixed(1) + "d";
}

// ─── COMPONENTE PRINCIPAL ──────────────────────────────────────────────────────
export default function MLStockAgent() {
  const [rangeDays, setRangeDays]   = useState(15);
  const [items, setItems]           = useState(null);   // array de QuiebreItem
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [step, setStep]             = useState("idle"); // idle | fetching | done
  const [emailDraft, setEmailDraft] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [copied, setCopied]         = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [filtroEstado, setFiltroEstado]     = useState("urgentes"); // urgentes | todos

  const runAnalysis = useCallback(async () => {
    setLoading(true);
    setStep("fetching");
    setItems(null);
    setEmailDraft("");
    setError("");

    try {
      const res = await fetch(`/api/ml/stock-quiebre?days=${rangeDays}`);
      const data = await res.json();

      if (!res.ok || data.error) {
        setError(data.error ?? `Error ${res.status}`);
        setStep("idle");
        return;
      }

      setItems(data);
      setStep("done");
    } catch (err) {
      setError("Error al conectar con el servidor: " + err.message);
      setStep("idle");
    } finally {
      setLoading(false);
    }
  }, [rangeDays]);

  const generateEmail = useCallback(async () => {
    if (!items) return;
    setEmailLoading(true);
    setEmailDraft("");

    const urgentes = items.filter(i => i.estado === "QUEBRADO" || i.estado === "CRITICO" || i.estado === "RIESGO");
    const stats = ["QUEBRADO", "CRITICO", "RIESGO", "SIN_VENTAS", "OK"].map(e => ({
      estado: e, count: items.filter(i => i.estado === e).length
    }));

    const prompt = `
Sos un agente de gestión de inventario para Tanyx, distribuidora de tecnología en Argentina.
Analizá los siguientes datos reales de Mercado Libre (últimos ${rangeDays} días) y redactá un email profesional en español dirigido al equipo de compras.

RESUMEN DE INVENTARIO (${items.length} publicaciones activas):
${stats.map(s => `- ${ESTADO_LABEL[s.estado] ?? s.estado}: ${s.count}`).join("\n")}

PRODUCTOS URGENTES (QUEBRADO + CRÍTICO + RIESGO):
${JSON.stringify(urgentes.slice(0, 30).map(i => ({
  producto: i.title,
  stock_actual: i.stock,
  vendido_en_periodo: i.vendido_periodo,
  ventas_diarias: i.ventas_diarias,
  dias_restantes: i.dias_restantes !== null ? Number(i.dias_restantes).toFixed(1) : "sin ventas",
  estado: ESTADO_LABEL[i.estado] ?? i.estado,
})), null, 2)}

INSTRUCCIONES:
- Asunto incluido al inicio (línea "Asunto: ...")
- Resumen ejecutivo: período analizado y conteo por estado
- Sección 🔴 QUEBRADOS si los hay
- Sección 🟠 CRÍTICOS (menos de 7 días de stock)
- Sección 🟡 EN RIESGO (7-30 días) si aplica
- Para cada producto: stock actual, días estimados, ventas/día, cantidad sugerida para 30 días (= ceil(ventas_diarias * 30))
- Cierre con llamada a acción urgente
- Firma: "Sistema de Alertas Tanyx · Powered by IA"
- Tono profesional, directo

Solo devolvé el cuerpo del email.
    `.trim();

    try {
      const res = await fetch("/api/claude/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json();
      // Soporta tanto respuesta directa como wrapped
      const text = data.text ?? data.content?.map(b => b.text ?? "").join("\n") ?? data.resumen ?? JSON.stringify(data);
      setEmailDraft(text);
    } catch (err) {
      setEmailDraft("Error al generar el email: " + err.message);
    } finally {
      setEmailLoading(false);
    }
  }, [items, rangeDays]);

  const copyEmail = () => {
    navigator.clipboard.writeText(emailDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openMailto = () => {
    if (!emailDraft) return;
    const lines    = emailDraft.split("\n");
    const subjLine = lines.find(l => l.toLowerCase().startsWith("asunto:"));
    const subject  = subjLine ? subjLine.replace(/^asunto:\s*/i, "") : "Alerta de Stock — Tanyx";
    const body     = lines.filter(l => !l.toLowerCase().startsWith("asunto:")).join("\n");
    window.open(`mailto:${recipientEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, "_blank");
  };

  // ── Stats ─────────────────────────────────────────────────────────────────────
  const stats = items ? ["QUEBRADO", "CRITICO", "RIESGO", "SIN_VENTAS", "OK"].map(e => ({
    estado: e, count: items.filter(i => i.estado === e).length
  })) : null;

  const visibleItems = items
    ? filtroEstado === "urgentes"
      ? items.filter(i => i.estado === "QUEBRADO" || i.estado === "CRITICO" || i.estado === "RIESGO")
      : items
    : [];

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div style={s.root}>
      {/* Nav */}
      <div style={{ marginBottom: 16 }}>
        <a href="/dashboard" style={{ fontSize: 13, color: "#64748b", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
          ← Volver al dashboard
        </a>
      </div>

      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.logo}>⬡</span>
          <div>
            <div style={s.title}>Análisis de Quiebre de Stock</div>
            <div style={s.subtitle}>Mercado Libre · Tanyx — velocidad de venta real por producto</div>
          </div>
        </div>
        <div style={s.badge}>IA Powered</div>
      </div>

      {/* Controls */}
      <div style={s.card}>
        <div style={s.controlsRow}>
          <div style={s.field}>
            <label style={s.label}>Período de análisis</label>
            <div style={s.rangeButtons}>
              {[7, 15, 30, 60].map(d => (
                <button key={d} onClick={() => setRangeDays(d)}
                  style={rangeDays === d ? { ...s.rangeBtn, ...s.rangeBtnActive } : s.rangeBtn}>
                  {d}d
                </button>
              ))}
            </div>
          </div>
          <div style={s.field}>
            <label style={s.label}>Email destinatario</label>
            <input type="email" placeholder="compras@tanyx.com.ar"
              value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
              style={s.input} />
          </div>
          <button onClick={runAnalysis} disabled={loading} style={s.runBtn}>
            {loading ? <><Spinner /> Analizando...</> : "▶ Ejecutar análisis"}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={s.errorBox}>{error}</div>
      )}

      {/* Pipeline */}
      <div style={s.pipeline}>
        {[
          { icon: "📦", label: "Items activos",   desc: "Todos los activos con stock" },
          { icon: "🛒", label: "Órdenes",          desc: `Últimos ${rangeDays} días` },
          { icon: "📊", label: "Velocidad",         desc: "Venta/día por producto" },
          { icon: "🚨", label: "Estado",            desc: "QUEBRADO / CRÍTICO / RIESGO" },
        ].map((p, i) => (
          <div key={i} style={s.pipelineItem}>
            <div style={{
              ...s.pipelineIcon,
              ...(step === "done" ? s.pipelineIconDone : {}),
              ...(step === "fetching" && i < 2 ? s.pipelineIconDone : {}),
            }}>{p.icon}</div>
            <div style={s.pipelineLabel}>{p.label}</div>
            <div style={s.pipelineDesc}>{p.desc}</div>
            {i < 3 && <div style={s.pipelineArrow}>→</div>}
          </div>
        ))}
      </div>

      {/* Results */}
      {items && stats && (
        <>
          {/* Stat cards */}
          <div style={s.statsRow}>
            {stats.map(({ estado, count }) => (
              <div key={estado} style={{ ...s.statCard, borderTop: `3px solid ${ESTADO_COLOR[estado]}` }}>
                <div style={s.statIcon}>{ESTADO_ICON[estado]}</div>
                <div style={{ color: ESTADO_COLOR[estado], fontSize: 26, fontWeight: 700, fontFamily: "monospace" }}>{count}</div>
                <div style={s.statLabel}>{ESTADO_LABEL[estado]}</div>
              </div>
            ))}
          </div>

          {/* Tabla */}
          <div style={s.card}>
            <div style={s.cardTitleRow}>
              <div style={s.cardTitle}>
                Detalle de inventario
                <span style={{ fontSize: 12, fontWeight: 400, color: "#94a3b8", marginLeft: 8 }}>
                  ({visibleItems.length} productos)
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => setFiltroEstado("urgentes")}
                  style={filtroEstado === "urgentes" ? { ...s.filterBtn, ...s.filterBtnActive } : s.filterBtn}>
                  Solo urgentes
                </button>
                <button onClick={() => setFiltroEstado("todos")}
                  style={filtroEstado === "todos" ? { ...s.filterBtn, ...s.filterBtnActive } : s.filterBtn}>
                  Todos
                </button>
              </div>
            </div>
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    {["Estado", "Días restantes", "Stock", "Vta/día", "Vendido período", "Producto", ""].map(h => (
                      <th key={h} style={s.th}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map(item => (
                    <tr key={item.id} style={s.tr}>
                      <td style={s.td}>
                        <span style={{
                          ...s.estadoBadge,
                          background: ESTADO_BG[item.estado],
                          color:      ESTADO_COLOR[item.estado],
                        }}>
                          {ESTADO_ICON[item.estado]} {ESTADO_LABEL[item.estado] ?? item.estado}
                        </span>
                      </td>
                      <td style={{ ...s.td, ...s.tdNum }}>
                        <span style={{
                          ...s.diasBadge,
                          background: ESTADO_BG[item.estado],
                          color:      ESTADO_COLOR[item.estado],
                        }}>
                          {fmtDias(item.dias_restantes)}
                        </span>
                      </td>
                      <td style={{ ...s.td, ...s.tdNum }}>{item.stock}</td>
                      <td style={{ ...s.td, ...s.tdNum }}>
                        {item.ventas_diarias > 0 ? item.ventas_diarias.toFixed(2) : "—"}
                      </td>
                      <td style={{ ...s.td, ...s.tdNum }}>{item.vendido_periodo}</td>
                      <td style={s.td}>
                        <span style={s.productName}>{item.title}</span>
                      </td>
                      <td style={s.td}>
                        {item.en_full && (
                          <span style={s.fullBadge} title="Stock Full (depósito ML) — no sincroniza con ERP">
                            Full ⚠️
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visibleItems.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ ...s.td, textAlign: "center", color: "#94a3b8", padding: 24 }}>
                        No hay productos urgentes 🎉
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Leyenda Full */}
            {visibleItems.some(i => i.en_full) && (
              <div style={{ marginTop: 12, padding: "8px 12px", background: "#fef9c3", borderRadius: 8, fontSize: 12, color: "#854d0e", border: "1px solid #fde047" }}>
                ⚠️ <strong>Full ⚠️</strong>: el stock mostrado viene de ML (depósito Full), no del ERP. Verificar stock real antes de reponer.
              </div>
            )}

            {/* Botón generar email */}
            <div style={{ marginTop: 16, display: "flex", gap: 8, alignItems: "center" }}>
              <button onClick={generateEmail} disabled={emailLoading} style={s.emailBtn}>
                {emailLoading ? <><Spinner /> Generando email...</> : "📧 Generar email de reposición"}
              </button>
            </div>
          </div>

          {/* Email */}
          {emailDraft && (
            <div style={s.card}>
              <div style={s.cardTitleRow}>
                <div style={s.cardTitle}>📧 Email generado por IA</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={copyEmail} style={s.actionBtn}>
                    {copied ? "✓ Copiado" : "Copiar"}
                  </button>
                  <button onClick={openMailto} style={{ ...s.actionBtn, ...s.actionBtnPrimary }}>
                    Abrir en Mail
                  </button>
                </div>
              </div>
              <pre style={s.emailPre}>{emailDraft}</pre>
            </div>
          )}
        </>
      )}

      {step === "idle" && (
        <div style={s.emptyState}>
          <div style={s.emptyIcon}>📊</div>
          <div style={s.emptyTitle}>Análisis de quiebre de stock</div>
          <div style={s.emptyDesc}>
            Calcula la velocidad de venta real por producto y clasifica cada uno
            según sus días de stock restante
          </div>
          <div style={{ marginTop: 16, display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
            {[
              { icon: "🔴", label: "QUEBRADO", desc: "Stock = 0" },
              { icon: "🟠", label: "CRÍTICO",  desc: "< 7 días" },
              { icon: "🟡", label: "RIESGO",   desc: "7–30 días" },
              { icon: "🟢", label: "OK",        desc: "> 30 días" },
            ].map(e => (
              <div key={e.label} style={s.legendItem}>
                <span>{e.icon}</span>
                <strong>{e.label}</strong>
                <span style={{ color: "#94a3b8" }}>{e.desc}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Spinner() {
  return <span style={s.spinner} />;
}

// ─── STYLES ────────────────────────────────────────────────────────────────────
const s = {
  root:             { fontFamily: "'DM Sans','Segoe UI',sans-serif", background: "#f8f9fb", minHeight: "100vh", padding: "24px 20px", maxWidth: 1100, margin: "0 auto" },
  header:           { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 },
  headerLeft:       { display: "flex", alignItems: "center", gap: 12 },
  logo:             { fontSize: 32, lineHeight: 1 },
  title:            { fontSize: 22, fontWeight: 700, color: "#0f172a", letterSpacing: "-0.5px" },
  subtitle:         { fontSize: 13, color: "#64748b" },
  badge:            { background: "#6366f1", color: "#fff", fontSize: 11, fontWeight: 600, padding: "4px 10px", borderRadius: 20, letterSpacing: "0.5px" },
  card:             { background: "#fff", borderRadius: 12, padding: "20px 24px", marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" },
  controlsRow:      { display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap" },
  field:            { display: "flex", flexDirection: "column", gap: 6 },
  label:            { fontSize: 12, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.5px" },
  rangeButtons:     { display: "flex", gap: 6 },
  rangeBtn:         { padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  rangeBtnActive:   { border: "1.5px solid #6366f1", background: "#eef2ff", color: "#6366f1" },
  input:            { padding: "8px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", fontSize: 14, color: "#0f172a", outline: "none", width: 220 },
  runBtn:           { padding: "10px 22px", borderRadius: 10, border: "none", background: "#0f172a", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 },
  errorBox:         { background: "#fef2f2", color: "#dc2626", padding: "12px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13 },
  pipeline:         { display: "flex", alignItems: "center", justifyContent: "center", gap: 0, marginBottom: 20, background: "#fff", borderRadius: 12, padding: "16px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", flexWrap: "wrap" },
  pipelineItem:     { display: "flex", flexDirection: "column", alignItems: "center", gap: 4, position: "relative" },
  pipelineIcon:     { width: 44, height: 44, borderRadius: 12, background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, transition: "all 0.3s" },
  pipelineIconDone: { background: "#eef2ff", boxShadow: "0 0 0 3px #c7d2fe" },
  pipelineLabel:    { fontSize: 12, fontWeight: 700, color: "#0f172a" },
  pipelineDesc:     { fontSize: 11, color: "#94a3b8" },
  pipelineArrow:    { position: "absolute", right: -18, top: 12, color: "#cbd5e1", fontSize: 18 },
  statsRow:         { display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 12, marginBottom: 16 },
  statCard:         { background: "#fff", borderRadius: 12, padding: "16px 20px", boxShadow: "0 1px 3px rgba(0,0,0,0.07)", display: "flex", flexDirection: "column", gap: 4 },
  statIcon:         { fontSize: 18 },
  statLabel:        { fontSize: 11, color: "#64748b", fontWeight: 500 },
  cardTitle:        { fontSize: 14, fontWeight: 700, color: "#0f172a" },
  cardTitleRow:     { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  filterBtn:        { padding: "5px 12px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  filterBtnActive:  { border: "1.5px solid #6366f1", background: "#eef2ff", color: "#6366f1" },
  tableWrap:        { overflowX: "auto" },
  table:            { width: "100%", borderCollapse: "collapse" },
  th:               { textAlign: "left", padding: "8px 12px", fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: "1.5px solid #f1f5f9" },
  tr:               { borderBottom: "1px solid #f8f9fb" },
  td:               { padding: "10px 12px", fontSize: 13, color: "#334155", verticalAlign: "middle" },
  tdNum:            { textAlign: "right", fontFamily: "monospace" },
  estadoBadge:      { display: "inline-block", padding: "2px 8px", borderRadius: 6, fontWeight: 700, fontSize: 11, whiteSpace: "nowrap" },
  diasBadge:        { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontWeight: 700, fontSize: 12, fontFamily: "monospace" },
  productName:      { fontWeight: 500, color: "#0f172a" },
  fullBadge:        { display: "inline-block", padding: "2px 7px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#fef9c3", color: "#854d0e", border: "1px solid #fde047", whiteSpace: "nowrap" },
  emailBtn:         { padding: "8px 18px", borderRadius: 8, border: "none", background: "#6366f1", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 },
  actionBtn:        { padding: "6px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: "#fff", color: "#334155", fontSize: 12, fontWeight: 600, cursor: "pointer" },
  actionBtnPrimary: { background: "#0f172a", color: "#fff", border: "none" },
  emailPre:         { background: "#f8f9fb", borderRadius: 8, padding: 16, fontSize: 13, color: "#334155", whiteSpace: "pre-wrap", lineHeight: 1.7, fontFamily: "monospace", border: "1px solid #e2e8f0", maxHeight: 400, overflowY: "auto" },
  emptyState:       { textAlign: "center", padding: "60px 20px" },
  emptyIcon:        { fontSize: 48, marginBottom: 12 },
  emptyTitle:       { fontSize: 18, fontWeight: 700, color: "#0f172a", marginBottom: 6 },
  emptyDesc:        { fontSize: 14, color: "#64748b", maxWidth: 400, margin: "0 auto" },
  legendItem:       { display: "flex", alignItems: "center", gap: 6, fontSize: 13, padding: "6px 12px", background: "#fff", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,0.07)" },
  spinner:          { display: "inline-block", width: 14, height: 14, border: "2px solid rgba(255,255,255,0.3)", borderTop: "2px solid currentColor", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
};
