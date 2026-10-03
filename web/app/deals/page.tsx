"use client";

import { EmptyState, PageHeader } from "@/components/Page";
import { SHOW_V2 } from "@/lib/config";
import { DealsV2 } from "./DealsV2";

export default function DealsPage() {
  if (!SHOW_V2) {
    return (
      <>
        <PageHeader title="Open deals" />
        <EmptyState>Deals aren&apos;t enabled on this deployment yet.</EmptyState>
      </>
    );
  }
  return <DealsV2 />;
}
