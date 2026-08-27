import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import Avatar from "@/components/Avatar";
import NotificationBell, { type Bell } from "@/components/NotificationBell";

export default async function Header() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile: {
    display_name: string;
    handle: string;
    avatar_url: string | null;
  } | null = null;
  let bells: Bell[] = [];
  let unread = 0;
  let messageUnread = 0;

  if (user) {
    const [{ data: me }, { data: notifications }, { data: badges }] = await Promise.all([
      supabase
        .from("profiles")
        .select("display_name, handle, avatar_url")
        .eq("id", user.id)
        .single(),
      supabase
        .from("notifications")
        .select("id, kind, slot_id, payload, created_at, read_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.rpc("my_badges"),
    ]);

    profile = me ?? null;
    bells = (notifications ?? []).map((row) => ({
      id: row.id,
      kind: row.kind,
      slotId: row.slot_id,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
      read: row.read_at !== null,
    }));

    const badge = badges?.[0];
    unread = badge?.bell_unread ?? 0;
    messageUnread = (badge?.primary_unread ?? 0) + (badge?.request_unread ?? 0);
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

        <nav className="flex items-center gap-5 text-sm">
          {user && profile ? (
            <>
              <Link href="/feed" className="hidden text-crew transition hover:text-key sm:inline">
                Feed
              </Link>
              <Link href="/slots" className="hidden text-crew transition hover:text-key sm:inline">
                Board
              </Link>

              <Link href="/inbox" className="relative text-crew transition hover:text-key">
                Inbox
                {messageUnread > 0 && (
                  <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center bg-signal px-1 text-[10px] font-semibold text-stage">
                    {messageUnread > 9 ? "9+" : messageUnread}
                  </span>
                )}
              </Link>

              <NotificationBell
                initialBells={bells}
                initialUnread={unread}
                userId={user.id}
              />

              <Link
                href={`/u/${profile.handle}`}
                aria-label="Your profile"
                className="transition hover:opacity-80"
              >
                <Avatar name={profile.display_name} url={profile.avatar_url} size={28} />
              </Link>

              <form action={signOut}>
                <button
                  type="submit"
                  className="hidden text-crew transition hover:text-key sm:inline"
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
