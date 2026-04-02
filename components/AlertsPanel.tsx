"use client";

type Alert = {
  tipo: "critica" | "advertencia" | "info";
  titulo: string;
  descripcion: string;
  accion: string;
};

export function AlertsPanel({
  alerts,
  resumen,
}: {
  alerts: Alert[];
  resumen: string;
}) {
  const empty = (!alerts || alerts.length === 0) && !resumen;

  if (empty) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
        Todavía no hay análisis. Click en <span className="font-medium">“Analizar con IA”</span>.
      </div>
    );
  }

  const pill = (tipo: Alert["tipo"]) => {
    switch (tipo) {
      case "critica":
        return "bg-red-50 text-red-700 border-red-200";
      case "advertencia":
        return "bg-amber-50 text-amber-800 border-amber-200";
      default:
        return "bg-blue-50 text-blue-700 border-blue-200";
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {resumen ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-4">
          <div className="text-xs font-semibold text-zinc-600">Resumen</div>
          <div className="mt-2 text-sm text-zinc-900">{resumen}</div>
        </div>
      ) : null}

      {alerts && alerts.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {alerts.map((a, idx) => (
            <div
              key={`${a.titulo}-${idx}`}
              className={`rounded-xl border p-4 ${pill(a.tipo)}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-zinc-900">
                  {a.titulo}
                </div>
                <div className="rounded-full border px-2 py-0.5 text-[11px] font-semibold">
                  {a.tipo.toUpperCase()}
                </div>
              </div>
              <div className="mt-2 text-sm text-zinc-800">{a.descripcion}</div>
              <div className="mt-3 text-xs font-semibold text-zinc-900">
                Acción:
                <span className="ml-1 font-normal text-zinc-800">
                  {a.accion}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

