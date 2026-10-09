"use client";

import { EmptyState, PageHeader } from "@/components/Page";
import { SHOW_DEALS } from "@/lib/config";
import { Deals } from "./Deals";

export default function DealsPage() {
  if (!SHOW_DEALS) {
    return (
      <>
        <PageHeader title="Open deals" />
        <EmptyState>Deals aren&apos;t enabled on this deployment yet.</EmptyState>
      </>
    );
  }
  return <Deals />;
}
