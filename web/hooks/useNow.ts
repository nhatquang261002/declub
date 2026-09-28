"use client";

import { useEffect, useState } from "react";

const nowSec = () => Math.floor(Date.now() / 1000);

/** Unix seconds, re-rendered every `intervalMs`. Drives expiry labels. */
export function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(nowSec);
  useEffect(() => {
    const timer = setInterval(() => setNow(nowSec()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
