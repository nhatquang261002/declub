"use client";

import { useState } from "react";
import { VersionSwitch, type TradeVersion } from "@/components/VersionSwitch";
import { TradesV1 } from "./TradesV1";
import { TradesV2 } from "./TradesV2";

export default function TradesPage() {
  const [version, setVersion] = useState<TradeVersion>("v1");
  const switcher = <VersionSwitch value={version} onChange={setVersion} />;
  return version === "v2" ? <TradesV2 switcher={switcher} /> : <TradesV1 switcher={switcher} />;
}
