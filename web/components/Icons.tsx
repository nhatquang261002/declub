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
export const MoreIcon = (p: P) => (<Icon {...p}><circle cx="5.5" cy="12" r="1" fill="currentColor" /><circle cx="12" cy="12" r="1" fill="currentColor" /><circle cx="18.5" cy="12" r="1" fill="currentColor" /></Icon>);
export const ArrowLeftIcon = (p: P) => (<Icon {...p}><path d="M19 12H5" /><path d="m11 6-6 6 6 6" /></Icon>);
export const SearchIcon = (p: P) => (<Icon {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></Icon>);
export const PinIcon = (p: P) => (<Icon {...p}><path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5Z" /><path d="M12 14v6" /></Icon>);
export const FlagIcon = (p: P) => (<Icon {...p}><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></Icon>);
export const TrashIcon = (p: P) => (<Icon {...p}><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 12.5h9l1-12.5" /></Icon>);
export const EyeIcon = (p: P) => (<Icon {...p}><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="2.8" /></Icon>);
export const EyeOffIcon = (p: P) => (<Icon {...p}><path d="M4 4l16 16" /><path d="M9.9 5.8A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.3 7.6A15.6 15.6 0 0 0 2.5 12S6 18.5 12 18.5a8.9 8.9 0 0 0 4.1-1" /></Icon>);
export const BanIcon = (p: P) => (<Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="m6 6 12 12" /></Icon>);
export const ShieldIcon = (p: P) => (<Icon {...p}><path d="M12 3.5 19 6v5.5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-2.5Z" /></Icon>);
export const CrownIcon = (p: P) => (<Icon {...p}><path d="M4 8l4 4 4-6 4 6 4-4-1.5 10h-13L4 8Z" /></Icon>);
export const UsersIcon = (p: P) => (<Icon {...p}><circle cx="9" cy="8.5" r="3.2" /><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5" /><path d="M15.5 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.8c1.8.6 3.1 2.2 3.5 4.7" /></Icon>);
export const ChatIcon = (p: P) => (<Icon {...p}><path d="M5 5h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 17h-8l-4.5 3.5V17H5a1.5 1.5 0 0 1-1.5-1.5v-9A1.5 1.5 0 0 1 5 5Z" /></Icon>);
export const TagIcon = (p: P) => (<Icon {...p}><path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8L21 12l-9 9-8.5-8.5Z" /><circle cx="8.5" cy="8.5" r="1.3" /></Icon>);
export const LinkIcon = (p: P) => (<Icon {...p}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></Icon>);
export const FlameIcon = (p: P) => (<Icon {...p}><path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.4 2.4-5.4 3.6-8.3.4 2 1.4 3.2 2.6 3.7C12 7 13 4.6 15.4 3c-.2 3 1.2 4.6 2.2 6.2.9 1.4 1.4 2.7 1.4 4.6 0 4.2-3 7.2-7 7.2Z" /></Icon>);
export const ListIcon = (p: P) => (<Icon {...p}><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r=".9" fill="currentColor" /><circle cx="4.5" cy="12" r=".9" fill="currentColor" /><circle cx="4.5" cy="18" r=".9" fill="currentColor" /></Icon>);
export const GridIcon = (p: P) => (<Icon {...p}><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><rect x="13" y="13" width="7" height="7" rx="1.5" /></Icon>);
export const TrendUpIcon = (p: P) => (<Icon {...p}><path d="m3.5 17 6-6 4 4 7-7.5" /><path d="M15 7.5h5.5V13" /></Icon>);
export const CoinIcon = (p: P) => (<Icon {...p}><circle cx="12" cy="12" r="8.5" /><path d="M14.8 9.2c-.5-.9-1.6-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2.1c1.6.3 2.8.9 2.8 2.1s-1.2 2-2.8 2c-1.2 0-2.3-.5-2.8-1.4" /><path d="M12 6v1.8M12 16.2V18" /></Icon>);
export const BadgeCheckIcon = (p: P) => (<Icon {...p}><path d="M12 2.8l2.2 1.6 2.7-.1.8 2.6 2.2 1.6-.8 2.6.8 2.6-2.2 1.6-.8 2.6-2.7-.1L12 21.2l-2.2-1.6-2.7.1-.8-2.6-2.2-1.6.8-2.6-.8-2.6 2.2-1.6.8-2.6 2.7.1L12 2.8Z" /><path d="m8.8 12.2 2.2 2.2 4.3-4.6" /></Icon>);

/** The X logo. Filled rather than stroked, so it doesn't use the shared stroke icon frame. */
export const XLogoIcon = ({ className = "size-3" }: P) => (
  <svg aria-hidden="true" className={className} viewBox="0 0 24 24" fill="currentColor">
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117Z" />
  </svg>
);
export const LockIcon = (p: P) => (<Icon {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></Icon>);
export const SendIcon = (p: P) => (<Icon {...p}><path d="M4 12 20 4l-4 16-4-6.5L4 12Z" /><path d="m12 13.5 8-9.5" /></Icon>);
