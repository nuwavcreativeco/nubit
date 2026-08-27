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
    <header className="sticky top-0 z-50 border-b border-line bg-stage/95 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="pip" aria-hidden />
          <span className="font-display text-xl font-bold tracking-tight">
            Nu<span className="text-signal">Bid</span>
          </span>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          {user ? (
            <>
              <Link href="/slots/mine" className="text-crew transition hover:text-key">
                My slots
              </Link>
              <Link href="/bids/mine" className="text-crew transition hover:text-key">
                My bids
              </Link>
              <Link href="/slots" className="font-medium text-key transition hover:text-signal">
                Browse open slots
              </Link>
              <span className="hidden meta sm:inline">{displayName}</span>
              <form action={signOut}>
                <button
                  type="submit"
                  className="text-crew transition hover:text-key"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link href="/auth/sign-in" className="text-crew transition hover:text-key">
                Sign in
              </Link>
              <Link
                href="/slots"
                className="font-medium text-key transition hover:text-signal"
              >
                Browse open slots
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
