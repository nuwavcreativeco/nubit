import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import Avatar from "@/components/Avatar";

function ago(iso: string) {
  const ms = Date.now() - Date.parse(iso);
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ box?: string }>;
}) {
  const { box } = await searchParams;
  const folder = box === "requests" ? "requests" : "primary";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="text-2xl tracking-tight">Sign in to read your messages</h1>
        <p className="mt-3 text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to see your inbox.
        </p>
      </main>
    );
  }

  const [{ data: threads }, { data: badges }] = await Promise.all([
    supabase.rpc("my_inbox", { p_folder: folder }),
    supabase.rpc("my_badges"),
  ]);

  const badge = badges?.[0];
  const tabs = [
    { key: "primary", label: "Primary", count: badge?.primary_unread ?? 0 },
    { key: "requests", label: "Requests", count: badge?.request_unread ?? 0 },
  ];

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-12">
      <h1 className="text-3xl tracking-tight">Inbox</h1>
      <p className="meta mt-2">
        People you follow land in Primary · everyone else in Requests
      </p>

      <div className="mt-6 flex gap-px bg-line">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "primary" ? "/inbox" : "/inbox?box=requests"}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-3 text-sm transition ${
              folder === tab.key
                ? "bg-rack-2 font-medium text-key"
                : "bg-rack text-crew hover:text-key"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center bg-signal px-1 text-[10px] font-semibold text-stage">
                {tab.count > 9 ? "9+" : tab.count}
              </span>
            )}
          </Link>
        ))}
      </div>

      {(threads ?? []).length === 0 ? (
        <p className="mt-10 text-crew">
          {folder === "requests"
            ? "No message requests."
            : "No messages yet. Open someone's profile and say hello."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {(threads ?? []).map((thread) => (
            <li key={thread.conversation_id}>
              <Link
                href={`/inbox/${thread.conversation_id}`}
                className="flex items-center gap-3 py-4 transition hover:opacity-80"
              >
                <Avatar
                  name={thread.other_name}
                  url={thread.other_avatar_url}
                  size={44}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-key">
                      {thread.other_name}
                    </p>
                    <span className="meta shrink-0">
                      {ago(thread.last_message_at)}
                    </span>
                  </div>
                  <p
                    className={`truncate text-sm ${
                      thread.unread > 0 ? "text-key" : "text-crew"
                    }`}
                  >
                    {thread.preview ?? "No messages yet"}
                  </p>
                </div>
                {thread.unread > 0 && (
                  <span className="flex h-5 min-w-5 shrink-0 items-center justify-center bg-signal px-1 text-[10px] font-semibold text-stage">
                    {thread.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
