"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCents, formatShootDate } from "@/lib/types";
import {
  markThreadRead,
  respondToOffer,
  sendMessage,
  sendOffer,
  withdrawOffer,
} from "@/app/inbox/actions";

export type ThreadMessage = {
  id: number;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ThreadOffer = {
  id: string;
  status: string;
  title: string;
  location: string;
  shootDate: string;
  priceCents: number;
  note: string | null;
  expiresAt: string;
  createdAt: string;
  slotId: string | null;
  posterUrl: string | null;
  mine: boolean;
};

type ReelOption = {
  id: string;
  caption: string | null;
  posterUrl: string | null;
  aspect: string;
};

function when(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function OfferCard({
  offer,
  onDone,
}: {
  offer: ThreadOffer;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const live = offer.status === "pending";

  function respond(accept: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await respondToOffer(offer.id, accept);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  function pull() {
    setError(null);
    startTransition(async () => {
      const result = await withdrawOffer(offer.id);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="my-4 border border-line bg-rack">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="label">
          {offer.mine ? "Offer you sent" : "Direct offer"}
        </span>
        <span
          className={`meta ${
            offer.status === "accepted"
              ? "text-signal"
              : live
                ? "text-key"
                : "text-crew"
          }`}
        >
          {offer.status}
        </span>
      </div>

      <div className="flex gap-4 p-4">
        {offer.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={offer.posterUrl}
            alt=""
            className="h-20 w-20 shrink-0 border border-line object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-key">{offer.title}</p>
          <p className="meta mt-1">
            {formatShootDate(offer.shootDate)} · {offer.location}
          </p>
          <p className="fig mt-2 text-2xl text-signal">
            {formatCents(offer.priceCents)}
          </p>
          {offer.note && <p className="mt-2 text-sm text-crew">{offer.note}</p>}
          {live && (
            <p className="meta mt-2">Expires {when(offer.expiresAt)}</p>
          )}
        </div>
      </div>

      {live && !offer.mine && (
        <div className="flex gap-px border-t border-line bg-line">
          <button
            onClick={() => respond(true)}
            disabled={pending}
            className="btn-signal flex-1 py-3 text-sm disabled:opacity-60"
          >
            {pending ? "…" : "Accept and book"}
          </button>
          <button
            onClick={() => respond(false)}
            disabled={pending}
            className="flex-1 bg-rack py-3 text-sm text-crew transition hover:text-key disabled:opacity-60"
          >
            Decline
          </button>
        </div>
      )}

      {live && offer.mine && (
        <button
          onClick={pull}
          disabled={pending}
          className="w-full border-t border-line py-3 text-sm text-crew transition hover:text-red-400 disabled:opacity-60"
        >
          {pending ? "…" : "Withdraw offer"}
        </button>
      )}

      {offer.status === "accepted" && offer.slotId && (
        <Link
          href={`/slots/${offer.slotId}`}
          className="block border-t border-line px-4 py-3 text-sm text-signal transition hover:text-key"
        >
          Booked — see the day →
        </Link>
      )}

      {error && <p className="px-4 pb-3 text-sm text-red-400">{error}</p>}
    </div>
  );
}

function OfferComposer({
  otherId,
  otherName,
  reels,
  onSent,
  onCancel,
}: {
  otherId: string;
  otherName: string;
  reels: ReelOption[];
  onSent: () => void;
  onCancel: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reelId, setReelId] = useState<string>("");

  const week = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const expiry = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 16);

  function submit(form: FormData) {
    setError(null);
    const dollars = Number(form.get("price"));
    startTransition(async () => {
      const result = await sendOffer({
        toUserId: otherId,
        title: String(form.get("title") ?? ""),
        location: String(form.get("location") ?? ""),
        shootDate: String(form.get("shootDate") ?? ""),
        priceCents: Math.round(dollars * 100),
        expiresAt: new Date(String(form.get("expiresAt"))).toISOString(),
        reelId: reelId || null,
        note: String(form.get("note") ?? ""),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      onSent();
    });
  }

  return (
    <form action={submit} className="my-4 border border-line bg-rack p-4">
      <p className="label">Offer {otherName} a day</p>

      <input
        name="title"
        required
        placeholder="What the shoot is"
        className="mt-3 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
      />
      <input
        name="location"
        required
        placeholder="Where"
        className="mt-2 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
      />

      <div className="mt-2 flex gap-2">
        <label className="flex-1">
          <span className="label">Shoot date</span>
          <input
            type="date"
            name="shootDate"
            required
            defaultValue={week}
            className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none focus:border-signal"
          />
        </label>
        <label className="flex-1">
          <span className="label">Price (whole dollars)</span>
          <input
            type="number"
            name="price"
            required
            min={1}
            step={1}
            placeholder="1200"
            className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
          />
        </label>
      </div>

      <label className="mt-2 block">
        <span className="label">Offer expires</span>
        <input
          type="datetime-local"
          name="expiresAt"
          required
          defaultValue={expiry}
          className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none focus:border-signal"
        />
      </label>

      {reels.length > 0 && (
        <label className="mt-2 block">
          <span className="label">Show them a reel (optional)</span>
          <select
            value={reelId}
            onChange={(e) => setReelId(e.target.value)}
            className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none focus:border-signal"
          >
            <option value="">No reel</option>
            {reels.map((reel) => (
              <option key={reel.id} value={reel.id}>
                {reel.caption || `${reel.aspect} reel`}
              </option>
            ))}
          </select>
        </label>
      )}

      <textarea
        name="note"
        rows={2}
        placeholder="Anything they should know (optional)"
        className="mt-2 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
      />

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-signal h-10 flex-1 text-sm disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send offer"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="btn-ghost h-10 px-5 text-sm"
        >
          Cancel
        </button>
      </div>

      <p className="meta mt-3">
        Accepting books the day on NuBid, so it still counts toward reviews and
        reliability.
      </p>
    </form>
  );
}

export default function MessageThread({
  conversationId,
  userId,
  otherId,
  otherName,
  initialMessages,
  offers,
  myReels,
}: {
  conversationId: string;
  userId: string;
  otherId: string;
  otherName: string;
  initialMessages: ThreadMessage[];
  offers: ThreadOffer[];
  myReels: ReelOption[];
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMessages(initialMessages), [initialMessages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Opening the thread is what marks it read; the badge in the header is
  // derived from the same last_read_at.
  useEffect(() => {
    void markThreadRead(conversationId).then(() => router.refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  // Unlike bids, a message IS visible to its recipient under RLS, so Postgres
  // Changes actually delivers this one.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`thread:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        () => router.refresh()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, router]);

  function submit() {
    const text = body.trim();
    if (!text) return;
    setError(null);
    setBody("");

    startTransition(async () => {
      const result = await sendMessage(conversationId, text);
      if ("error" in result) {
        setError(result.error);
        setBody(text);
        return;
      }
      router.refresh();
    });
  }

  // Messages and offers share one timeline, ordered by when they happened.
  const timeline = [
    ...messages.map((m) => ({ at: m.createdAt, kind: "message" as const, m })),
    ...offers.map((o) => ({ at: o.createdAt, kind: "offer" as const, o })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  return (
    <>
      <div className="flex-1 space-y-2 overflow-y-auto py-6">
        {timeline.length === 0 && (
          <p className="text-crew">No messages yet. Say hello.</p>
        )}

        {timeline.map((entry) =>
          entry.kind === "offer" ? (
            <OfferCard
              key={`offer-${entry.o.id}`}
              offer={entry.o}
              onDone={() => router.refresh()}
            />
          ) : (
            <div
              key={`msg-${entry.m.id}`}
              className={`flex ${entry.m.mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[75%] px-3 py-2 text-sm ${
                  entry.m.mine
                    ? "bg-signal text-stage"
                    : "border border-line bg-rack text-key"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{entry.m.body}</p>
                <p
                  className={`meta mt-1 ${
                    entry.m.mine ? "text-stage/70" : ""
                  }`}
                >
                  {when(entry.m.createdAt)}
                </p>
              </div>
            </div>
          )
        )}
        <div ref={endRef} />
      </div>

      {composing ? (
        <OfferComposer
          otherId={otherId}
          otherName={otherName}
          reels={myReels}
          onSent={() => {
            setComposing(false);
            router.refresh();
          }}
          onCancel={() => setComposing(false)}
        />
      ) : (
        <div className="sticky bottom-0 border-t border-line bg-stage py-4">
          {error && <p className="mb-2 text-sm text-red-400">{error}</p>}
          <div className="flex gap-2">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              placeholder="Write a message"
              className="min-h-10 flex-1 resize-none border border-line bg-rack px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
            />
            <button
              onClick={submit}
              disabled={pending || !body.trim()}
              className="btn-signal h-10 px-5 text-sm disabled:opacity-40"
            >
              Send
            </button>
          </div>
          <button
            onClick={() => setComposing(true)}
            className="meta mt-3 text-signal transition hover:text-key"
          >
            + Send a direct offer
          </button>
        </div>
      )}
    </>
  );
}
