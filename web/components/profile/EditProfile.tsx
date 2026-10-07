"use client";

import { useState } from "react";
import { useSignIn } from "@/hooks/useSignIn";
import { useOwnAbout } from "@/hooks/useWalletProfile";
import { BIO_MAX, NAME_MAX } from "@/lib/about";
import { AvatarSection } from "./AvatarSection";
import { ShareHandle } from "./ShareHandle";

const count = (text: string) => Array.from(text).length;

/** The name and bio, with how much room is left. They show to anyone who opens the profile. */
function AboutSection() {
  const own = useOwnAbout();
  return (
    <section className="page-section px-5 py-5">
      <h2 className="text-lg font-semibold">About you</h2>
      <p className="mt-1 text-sm text-muted">
        A name and a few lines for your profile. They show on every wallet linked to your sign-in. Anyone can write any name,
        so it is never used to tell traders apart: deals and posts keep showing your verified handle and your address.
      </p>
      {/* The form starts from what the server has, so it waits for it rather than being filled in afterwards. */}
      {own.isLoading ? <p className="mt-4 text-sm text-muted">Loading…</p> : <AboutForm own={own} />}
    </section>
  );
}

function AboutForm({ own }: { own: ReturnType<typeof useOwnAbout> }) {
  const stored = own.about;
  const [name, setName] = useState(stored?.name ?? "");
  const [bio, setBio] = useState(stored?.bio ?? "");
  const dirty = name.trim() !== (stored?.name ?? "") || bio.trim() !== (stored?.bio ?? "");
  const tooLong = count(name.trim()) > NAME_MAX || count(bio.trim()) > BIO_MAX;

  return (
    <form
      className="mt-4 flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void own.save({ name, bio }).catch(() => {});
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Display name
        <input
          className="input font-normal"
          value={name}
          maxLength={NAME_MAX * 2}
          placeholder="How you want to be called"
          autoComplete="off"
          onChange={(event) => setName(event.target.value)}
        />
        <span className={`text-xs font-normal ${count(name.trim()) > NAME_MAX ? "text-danger" : "text-muted"}`}>
          {count(name.trim())}/{NAME_MAX}
        </span>
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-semibold">
        Bio
        <textarea
          className="input min-h-24 resize-y font-normal"
          value={bio}
          rows={3}
          placeholder="What you collect, what you’re looking for"
          onChange={(event) => setBio(event.target.value)}
        />
        <span className={`text-xs font-normal ${count(bio.trim()) > BIO_MAX ? "text-danger" : "text-muted"}`}>
          {count(bio.trim())}/{BIO_MAX}
        </span>
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" className="btn-primary" disabled={own.saving || !dirty || tooLong}>
          {own.saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

/**
 * Everything a user sets about their profile (ADR 0042), in one place: name and bio, avatar, and
 * whether their X or Discord handle shows beside their wallet. Each part saves on its own.
 */
export function EditProfile() {
  const own = useOwnAbout();
  const signIn = useSignIn();
  if (!own.can) {
    return (
      <div className="page-section flex flex-col items-center gap-4 px-6 py-10 text-center">
        <p className="text-muted">Sign in to change your profile.</p>
        <button className="btn-primary" disabled={!signIn} onClick={() => signIn?.()}>
          Sign in
        </button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6">
      <AboutSection />
      <AvatarSection />
      <ShareHandle />
    </div>
  );
}
