"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useConnection } from "wagmi";
import { PageHeader, RequireWallet } from "@/components/Page";
import { profilePath } from "@/lib/about";

/** Your own profile is at your wallet's address; this sends you there. */
function ToMine() {
  const { address } = useConnection();
  const router = useRouter();
  useEffect(() => {
    if (address) router.replace(profilePath(address));
  }, [address, router]);
  return <p className="text-sm text-muted">Opening your profile…</p>;
}

export default function MyProfilePage() {
  return (
    <>
      <PageHeader title="Profile" />
      <RequireWallet reason="Connect a wallet to see and edit your profile.">
        <ToMine />
      </RequireWallet>
    </>
  );
}
