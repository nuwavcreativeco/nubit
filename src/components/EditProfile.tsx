"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProfile } from "@/app/u/actions";

/**
 * Name, bio and city. The handle is deliberately not editable: it is the
 * profile's URL and people will have shared it.
 */
export default function EditProfile({
  displayName,
  bio,
  city,
}: {
  displayName: string;
  bio: string | null;
  city: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState(displayName);
  const [about, setAbout] = useState(bio ?? "");
  const [where, setWhere] = useState(city ?? "");

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateProfile({
        displayName: name,
        bio: about,
        city: where,
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="btn-ghost h-9 px-4 text-sm"
      >
        Edit profile
      </button>
    );
  }

  return (
    <div className="w-full border border-line bg-rack p-4">
      <p className="label">Edit profile</p>

      <label className="mt-3 block">
        <span className="label">Display name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none focus:border-signal"
        />
      </label>

      <label className="mt-2 block">
        <span className="label">Bio</span>
        <textarea
          value={about}
          onChange={(e) => setAbout(e.target.value)}
          rows={3}
          placeholder="What you shoot, who you shoot it for."
          className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
        />
      </label>

      <label className="mt-2 block">
        <span className="label">City</span>
        <input
          value={where}
          onChange={(e) => setWhere(e.target.value)}
          placeholder="Where you're based"
          className="mt-1 w-full border border-line bg-stage px-3 py-2 text-sm text-key outline-none placeholder:text-crew focus:border-signal"
        />
      </label>

      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="btn-signal h-9 px-5 text-sm disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => setOpen(false)} className="btn-ghost h-9 px-4 text-sm">
          Cancel
        </button>
      </div>
    </div>
  );
}
