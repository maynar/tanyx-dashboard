"use client";

import type { KPIs } from "@/lib/ml-client";

export function ProductsTable({
  top_productos,
}: {
  top_productos: KPIs["top_productos"];
}) {
  return (
    <div className="overflow-x-auto">
      {top_productos.length === 0 ? (
        <div className="text-sm text-zinc-600">No hay datos suficientes.</div>
      ) : (
        <table className="w-full min-w-[520px] border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="w-2/3 px-3 py-2 text-left text-xs font-semibold text-zinc-600">
                Producto
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600">
                Ventas (u)
              </th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600">
                Facturación
              </th>
            </tr>
          </thead>
          <tbody>
            {top_productos.map((p) => (
              <tr key={p.title} className="border-t border-zinc-100">
                <td className="px-3 py-2 text-sm font-medium text-zinc-900">
                  {p.title}
                </td>
                <td className="px-3 py-2 text-sm text-zinc-700">
                  {p.ventas.toLocaleString("es-AR")}
                </td>
                <td className="px-3 py-2 text-sm text-zinc-700">
                  {p.facturacion.toLocaleString("es-AR", {
                    maximumFractionDigits: 2,
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

