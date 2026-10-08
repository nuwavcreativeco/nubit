import { Suspense } from 'react';

async function LoginForm({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next = '/', error } = await searchParams;
  return (
    <form method="post" action="/api/auth/login" className="w-80 border border-line bg-panel p-6">
      <div className="mb-5 font-mono text-[11px] uppercase tracking-[0.2em] text-muted">Ecosystem OS</div>
      <label className="mb-2 block text-xs text-muted" htmlFor="password">Access password</label>
      <input id="password" name="password" type="password" autoFocus className="mb-3 w-full border border-line bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent" />
      <input type="hidden" name="next" value={next} />
      {error && <p className="mb-3 text-xs text-neg">Incorrect password.</p>}
      <button className="w-full bg-accent px-3 py-2 text-sm font-medium text-black">Enter</button>
    </form>
  );
}

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <main className="grid min-h-screen place-items-center bg-bg text-fg">
      <Suspense>
        <LoginForm searchParams={searchParams as Promise<{ next?: string; error?: string }>} />
      </Suspense>
    </main>
  );
}
