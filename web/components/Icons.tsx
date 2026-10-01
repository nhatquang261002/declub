import type { ReactNode } from "react";

/** Small stroke icons for the header controls. All share one 24px grid and inherit the text colour. */
function Icon({ children, className = "size-4" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

type P = { className?: string };

export const BellIcon = (p: P) => (
  <Icon {...p}><path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" /><path d="M10 19a2 2 0 0 0 4 0" /></Icon>
);
export const WalletIcon = (p: P) => (
  <Icon {...p}><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H19a1 1 0 0 1 1 1v2H7a3 3 0 0 0 0 6h13v3a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 16.5v-9Z" /><path d="M20 8H7a3 3 0 0 0 0 6h13V8Z" /><circle cx="16.5" cy="11" r=".6" fill="currentColor" /></Icon>
);
export const ChevronIcon = (p: P) => (<Icon {...p}><path d="m6 9 6 6 6-6" /></Icon>);
export const CopyIcon = (p: P) => (<Icon {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></Icon>);
export const CheckIcon = (p: P) => (<Icon {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></Icon>);
export const ExternalIcon = (p: P) => (<Icon {...p}><path d="M14 4h6v6" /><path d="M20 4 10 14" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></Icon>);
export const UserIcon = (p: P) => (<Icon {...p}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></Icon>);
export const SignOutIcon = (p: P) => (<Icon {...p}><path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" /><path d="M16 8l4 4-4 4" /><path d="M20 12H9" /></Icon>);
export const PlusIcon = (p: P) => (<Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>);
export const InboxIcon = (p: P) => (<Icon {...p}><path d="M4 13 6.5 5.5A2 2 0 0 1 8.4 4h7.2a2 2 0 0 1 1.9 1.5L20 13" /><path d="M4 13v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4h-5a3 3 0 0 1-6 0H4Z" /></Icon>);
export const ClockIcon = (p: P) => (<Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Icon>);
export const SwapIcon = (p: P) => (<Icon {...p}><path d="M5 8h13l-3-3" /><path d="M19 16H6l3 3" /></Icon>);
export const PauseIcon = (p: P) => (<Icon {...p}><path d="M9 6v12M15 6v12" /></Icon>);
export const CrossIcon = (p: P) => (<Icon {...p}><path d="M6 6l12 12M18 6 6 18" /></Icon>);

/** The X logo. Filled rather than stroked, so it doesn't use the shared stroke icon frame. */
export const XLogoIcon = ({ className = "size-3" }: P) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
  </svg>
);
