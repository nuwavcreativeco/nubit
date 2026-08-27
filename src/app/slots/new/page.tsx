"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSlot } from "@/app/slots/actions";
import { saveSlotLocation } from "@/app/slots/location-actions";
import { getCurrentCoords, type Coords } from "@/lib/geo";

const FIELD =
  "border border-line bg-rack px-3 py-2 text-key outline-none focus:border-signal";

/** Bidding closes 48h before the shoot at 6pm, so the crew can still plan. */
function defaultCloseFor(shootDate: string): string {
  if (!shootDate) return "";
  const [y, m, d] = shootDate.split("-").map(Number);
  const close = new Date(y, m - 1, d, 18, 0);
  close.setDate(close.getDate() - 2);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${close.getFullYear()}-${pad(close.getMonth() + 1)}-${pad(
    close.getDate()
  )}T${pad(close.getHours())}:${pad(close.getMinutes())}`;
}

export default function NewSlotPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [shootDate, setShootDate] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [closeTouched, setCloseTouched] = useState(false);

  async function handleUseMyLocation() {
    setLocating(true);
    setError(null);
    try {
      setCoords(await getCurrentCoords());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read your location.");
    }
    setLocating(false);
  }

  function handleShootDate(value: string) {
    setShootDate(value);
    if (!closeTouched) setClosesAt(defaultCloseFor(value));
  }

  async function handleSubmit(formData: FormData) {
    setError(null);

    // datetime-local has no timezone. Resolving it here means the instant we
    // store is the one the poster picked on their own clock.
    if (!closesAt) {
      setError("Pick when bidding closes.");
      return;
    }
    formData.set("closes_at_iso", new Date(closesAt).toISOString());

    setPending(true);
    const result = await createSlot(formData);
    if ("error" in result) {
      setPending(false);
      setError(result.error);
      return;
    }

    // The slot exists either way; a location that fails to save is a warning,
    // not a lost post — it can be set later from My slots.
    if (coords) {
      const located = await saveSlotLocation(
        result.slotId,
        coords.lat,
        coords.lng,
        String(formData.get("location") ?? "")
      );
      if ("error" in located) {
        setPending(false);
        setError(`Slot posted, but the location didn't save: ${located.error}`);
        return;
      }
    }

    router.push("/slots/mine");
  }

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-6 py-16">
      <h1 className="text-3xl tracking-tight">Post a slot</h1>
      <p className="mt-2 text-crew">
        Set the floor and the claim price. Bidders move it up in steps until
        the clock runs out.
      </p>

      <form action={handleSubmit} className="mt-8 flex flex-col gap-5">
        <label className="flex flex-col gap-2 text-sm">
          Title
          <input
            name="title"
            required
            placeholder="Half-day product shoot, Ballard studio"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Shoot date
          <input
            type="date"
            name="shoot_date"
            required
            value={shootDate}
            onChange={(e) => handleShootDate(e.target.value)}
            className={FIELD}
          />
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Call time
            <input type="time" name="starts_at" defaultValue="10:00" className={FIELD} />
          </label>
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Wrap
            <input type="time" name="ends_at" defaultValue="18:00" className={FIELD} />
          </label>
        </div>

        <label className="flex flex-col gap-2 text-sm">
          Bidding closes
          <input
            type="datetime-local"
            required
            value={closesAt}
            onChange={(e) => {
              setCloseTouched(true);
              setClosesAt(e.target.value);
            }}
            className={FIELD}
          />
          <span className="text-xs text-crew">
            Defaults to 48 hours before the shoot. A bid in the last five
            minutes pushes this out another five.
          </span>
        </label>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Location
            <input name="location" required placeholder="Neighbourhood, city" className={FIELD} />
          </label>
          <label className="flex w-28 flex-col gap-2 text-sm">
            Radius (mi)
            <input
              type="number"
              name="radius_mi"
              min="1"
              step="1"
              defaultValue="25"
              className={FIELD}
            />
          </label>
        </div>

        <div className="border border-line bg-rack p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm">Pin it on the map</p>
              <p className="mt-1 text-xs text-crew">
                {coords
                  ? "Location captured from this device."
                  : "Optional — but slots without a pin don't show up in nearby search."}
              </p>
            </div>
            <button
              type="button"
              onClick={handleUseMyLocation}
              disabled={locating}
              className="border border-line px-4 py-2 text-sm text-key transition hover:border-signal hover:text-signal disabled:opacity-60"
            >
              {locating
                ? "Locating…"
                : coords
                  ? "Use this spot instead"
                  : "Use my current location"}
            </button>
          </div>
          <p className="mt-3 text-xs text-crew">
            This reads where <em>you</em> are right now, so only use it on site.
            Otherwise post the slot and set the pin from My slots when you get
            there — the pin locks once someone bids.
          </p>
        </div>

        <div className="flex gap-4">
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Floor (USD)
            <input
              type="number"
              name="floor_rate"
              min="1"
              step="1"
              required
              placeholder="450"
              className={FIELD}
            />
          </label>
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Step (USD)
            <input
              type="number"
              name="step"
              min="1"
              step="1"
              required
              defaultValue="50"
              className={FIELD}
            />
          </label>
          <label className="flex flex-1 flex-col gap-2 text-sm">
            Claim (USD)
            <input
              type="number"
              name="claim"
              min="1"
              step="1"
              required
              placeholder="1100"
              className={FIELD}
            />
          </label>
        </div>
        <p className="-mt-2 text-xs text-crew">
          Floor and claim both have to land on the step — bids can only be
          placed on step boundaries.
        </p>

        <label className="flex flex-col gap-2 text-sm">
          Delivers (comma separated)
          <input
            name="delivers"
            placeholder="1 hero cut, 3 verticals, raw files, 6-day turnaround"
            className={FIELD}
          />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Gear (comma separated)
          <input name="gear" placeholder="FX3, 24-70, lav kit" className={FIELD} />
        </label>

        <label className="flex flex-col gap-2 text-sm">
          Details (optional)
          <textarea
            name="description"
            rows={4}
            placeholder="What the shoot needs, what's on site, anything a bidder should know."
            className={FIELD}
          />
        </label>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={pending}
          className="mt-2 bg-signal px-5 py-3 text-sm font-medium text-stage transition hover:bg-signal-dim disabled:opacity-60"
        >
          {pending ? "Posting…" : "Post slot"}
        </button>
      </form>
    </main>
  );
}
