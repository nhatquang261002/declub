"use client";

import { useState } from "react";
import { VersionSwitch, type DealVersion } from "@/components/VersionSwitch";
import { swapIntents, swapV2 } from "@/lib/contracts";
import { DealsV1 } from "./DealsV1";
import { DealsV2 } from "./DealsV2";

export default function DealsPage() {
  const [version, setVersion] = // Signed swaps share the multi-asset book, so open on it once they exist.
  useState<DealVersion>(swapV2 && swapIntents ? "v2" : "v1");
  const switcher = <VersionSwitch value={version} onChange={setVersion} />;
  return version === "v2" ? <DealsV2 switcher={switcher} /> : <DealsV1 switcher={switcher} />;
}
