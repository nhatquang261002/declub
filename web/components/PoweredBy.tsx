"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

// Services the app runs on; Envio only when the fill watcher has a HyperSync token (ADR 0051).
const PARTNERS = [
  { name: "Monad", logo: "/brand/mon.svg", href: "https://monad.xyz" },
  { name: "Privy", logo: "/brand/partners/privy.png", href: "https://privy.io" },
  { name: "Envio", logo: "/brand/partners/envio.png", href: "https://envio.dev" },
  { name: "Alchemy", logo: "/brand/partners/alchemy.svg", href: "https://www.alchemy.com" },
  { name: "Railway", logo: "/brand/partners/railway.svg", href: "https://railway.com" },
];

// A few partners are narrower than a wide screen, so each half repeats them until it overfills.
const SET = [...PARTNERS, ...PARTNERS, ...PARTNERS];

/** Footer strip that scrolls the partner logos sideways; home page only. Pauses on hover and stands still for reduced motion. */
export function PoweredBy() {
  if (usePathname() !== "/") return null;
  return (
    <div className="powered-by">
      <span className="powered-by-tag">Powered by</span>
      <div className="powered-by-viewport">
        <div className="powered-by-track">
          <PartnerSet />
          <PartnerSet hidden />
        </div>
      </div>
    </div>
  );
}

function PartnerSet({ hidden = false }: { hidden?: boolean }) {
  return (
    <ul className="powered-by-set" aria-hidden={hidden || undefined}>
      {SET.map((p, i) => (
        <li key={i}>
          <a href={p.href} target="_blank" rel="noreferrer" tabIndex={hidden ? -1 : undefined}>
            <Image src={p.logo} alt="" width={24} height={24} />
            <span className="powered-by-name">{p.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
