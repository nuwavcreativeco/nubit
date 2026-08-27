import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Avatar from "@/components/Avatar";
import MessageThread, {
  type ThreadMessage,
  type ThreadOffer,
} from "@/components/MessageThread";

export default async function ThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-start justify-center px-6 py-24">
        <h1 className="text-2xl tracking-tight">Sign in to read this thread</h1>
        <p className="mt-3 text-crew">
          <Link href="/auth/sign-in" className="text-signal underline">
            Sign in
          </Link>{" "}
          to continue.
        </p>
      </main>
    );
  }

  // The participants policy only returns rows for threads you're in, so an
  // empty result here is also the authorisation answer.
  const { data: participants } = await supabase
    .from("conversation_participants")
    .select("user_id")
    .eq("conversation_id", id);

  if (!participants || participants.length === 0) notFound();

  const otherId = participants.find((p) => p.user_id !== user.id)?.user_id;
  if (!otherId) notFound();

  const [{ data: other }, { data: messages }, { data: received }, { data: sent }, { data: myReels }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, handle, avatar_url")
        .eq("id", otherId)
        .single(),
      supabase
        .from("messages")
        .select("id, sender_id, body, created_at")
        .eq("conversation_id", id)
        .order("created_at", { ascending: true })
        .limit(200),
      supabase.rpc("my_offers", { p_box: "received" }),
      supabase.rpc("my_offers", { p_box: "sent" }),
      supabase.rpc("my_reels"),
    ]);

  if (!other) notFound();

  // "mine" is simply which box it came out of: sent by me, or sent to me.
  type OfferRow = NonNullable<typeof received>[number];
  const shape = (o: OfferRow, mine: boolean): ThreadOffer => ({
    id: o.id,
    status: o.status,
    title: o.title,
    location: o.location,
    shootDate: o.shoot_date,
    priceCents: o.price_cents,
    note: o.note,
    expiresAt: o.expires_at,
    createdAt: o.created_at,
    slotId: o.slot_id,
    posterUrl: o.reel_poster_url,
    mine,
  });

  const inThisThread = (o: OfferRow) => o.conversation_id === id;

  const offers: ThreadOffer[] = [
    ...(sent ?? []).filter(inThisThread).map((o) => shape(o, true)),
    ...(received ?? []).filter(inThisThread).map((o) => shape(o, false)),
  ].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const thread: ThreadMessage[] = (messages ?? []).map((m) => ({
    id: m.id,
    body: m.body,
    createdAt: m.created_at,
    mine: m.sender_id === user.id,
  }));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-6 py-8">
      <header className="flex items-center gap-3 border-b border-line pb-4">
        <Link href="/inbox" className="meta text-crew hover:text-key">
          ←
        </Link>
        <Link href={`/u/${other.handle}`} className="flex items-center gap-3">
          <Avatar name={other.display_name} url={other.avatar_url} size={40} />
          <span>
            <span className="block text-sm font-medium text-key">
              {other.display_name}
            </span>
            <span className="meta block">@{other.handle}</span>
          </span>
        </Link>
      </header>

      <MessageThread
        conversationId={id}
        userId={user.id}
        otherId={other.id}
        otherName={other.display_name}
        initialMessages={thread}
        offers={offers}
        myReels={(myReels ?? []).map((r) => ({
          id: r.id,
          caption: r.caption,
          posterUrl: r.poster_url,
          aspect: r.aspect,
        }))}
      />
    </main>
  );
}
