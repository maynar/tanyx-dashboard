export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center px-6 py-16">
      <main className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">tanyx-dashboard</h1>
          <p className="text-zinc-600">
            Iniciá sesión con tu cuenta de Mercado Libre para cargar tus KPIs.
          </p>
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href="/api/auth/login"
            className="inline-flex h-11 items-center justify-center rounded-xl bg-zinc-900 px-5 text-white transition-colors hover:bg-zinc-800"
          >
            Conectar Mercado Libre
          </a>
          <p className="text-sm text-zinc-500">
            Se guardan el `access_token` y `user_id` en cookies `httpOnly`.
          </p>
        </div>
      </main>
    </div>
  );
}
