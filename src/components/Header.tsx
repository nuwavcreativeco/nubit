import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let displayName: string | null = null;
  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", user.id)
      .single();
    displayName = profile?.display_name ?? user.email ?? null;
  }

  return (
    <header className="border-b border-line px-6 py-4">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between">
        <Link href="/" className="font-display text-lg">
          Nubid
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          <Link href="/slots" className="text-ink-dim transition hover:text-ink">
            Open slots
          </Link>

          {user ? (
            <div className="flex items-center gap-4">
              <Link href="/slots/mine" className="text-ink-dim transition hover:text-ink">
                My slots
              </Link>
              <Link href="/bids/mine" className="text-ink-dim transition hover:text-ink">
                My bids
              </Link>
              <span className="text-ink-dim">{displayName}</span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-ink-dim underline transition hover:text-ink"
                >
                  Sign out
                </button>
              </form>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link href="/auth/sign-in" className="text-ink-dim transition hover:text-ink">
                Sign in
              </Link>
              <Link
                href="/auth/sign-up"
                className="rounded-md bg-brass px-3 py-1.5 font-medium text-canvas transition hover:bg-brass-dim"
              >
                Sign up
              </Link>
            </div>
          )}
        </nav>
      </div>
    </header>
  );
}
