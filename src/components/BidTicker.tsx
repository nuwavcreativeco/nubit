"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/types";

const FLOOR_CENTS = 40000; // $400 floor rate
const BID_STEPS_CENTS = [40000, 47500, 55000, 62000, 68000];

export default function BidTicker() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setStep((s) => (s + 1) % BID_STEPS_CENTS.length);
    }, 1800);
    return () => clearInterval(id);
  }, []);

  const current = BID_STEPS_CENTS[step];
  const isFloor = current === FLOOR_CENTS;

  return (
    <div className="w-full max-w-sm border border-line bg-rack p-6 shadow-2xl shadow-black/40">
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-crew">
        <span>Half-day shoot &middot; Studio</span>
        <span className="text-signal">open</span>
      </div>

      <div className="mt-6 flex items-baseline gap-3">
        <span
          className={`font-display text-5xl tabular-nums transition-colors duration-500 ${
            isFloor ? "text-signal" : "text-signal"
          }`}
        >
          {formatCents(current)}
        </span>
        <span className="text-sm text-crew">
          {isFloor ? "floor rate" : "current bid"}
        </span>
      </div>

      <div className="mt-5 h-1 w-full overflow-hidden bg-line">
        <div
          className="h-full bg-signal transition-all duration-500 ease-out"
          style={{ width: `${(step / (BID_STEPS_CENTS.length - 1)) * 100}%` }}
        />
      </div>

      <p className="mt-4 text-sm text-crew">
        {step + 1 < BID_STEPS_CENTS.length
          ? "Bidding is open — creators are pushing the rate up."
          : "Videographer can award the slot any time."}
      </p>
    </div>
  );
}
