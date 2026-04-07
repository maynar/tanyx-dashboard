"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        const json = await res.json().catch(() => null);
        setError(json?.error ?? "Error al iniciar sesión.");
      }
    } catch {
      setError("Error de red.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">tanyx-dashboard</h1>
          <p className="text-zinc-600">
            Iniciá sesión para ver los KPIs de Mercado Libre.
          </p>
        </div>

        {/* Login por contraseña (colaboradores) */}
        <form onSubmit={handlePasswordLogin} className="mt-8 flex flex-col gap-3">
          <label className="text-sm font-medium text-zinc-700">Contraseña</label>
          <div className="flex gap-2">
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Ingresá la contraseña"
              required
              className="h-11 flex-1 rounded-xl border border-zinc-300 px-4 text-sm outline-none focus:border-zinc-500"
            />
            <button
              type="submit"
              disabled={loading}
              className="h-11 rounded-xl bg-zinc-900 px-5 text-sm text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
            >
              {loading ? "Entrando…" : "Entrar"}
            </button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </form>

        {/* Login ML OAuth (dueño) */}
        <div className="mt-6 border-t border-zinc-100 pt-6 flex flex-col gap-2">
          <p className="text-xs text-zinc-400">¿Sos el dueño de la cuenta?</p>
          <a
            href="/api/auth/login"
            className="inline-flex h-10 w-fit items-center justify-center rounded-xl border border-zinc-300 px-4 text-sm text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            Conectar con Mercado Libre
          </a>
        </div>
      </main>
    </div>
  );
}
