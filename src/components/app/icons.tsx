import type { ReactNode } from "react";

/** 24px line icons (1.8 stroke, round caps), drawn at the size the caller asks for. */
function Icon({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

type IconProps = { size?: number };

export function EditorIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </Icon>
  );
}

export function DesignIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="7" cy="18" r="2" />
    </Icon>
  );
}

export function AnalyticsIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M4 20V11" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M21 20H3" />
    </Icon>
  );
}

export function DomainsIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9s1.3-6.4 3.8-9z" />
    </Icon>
  );
}

/** Settings & billing in the sidebar (a card). */
export function BillingIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
    </Icon>
  );
}

/** Account in the phone tab bar (a person). */
export function AccountIcon({ size = 16 }: IconProps) {
  return (
    <Icon size={size}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </Icon>
  );
}

export function ChevronDownIcon({ size = 14 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M7 10l5 5 5-5" />
    </Icon>
  );
}

export function CheckIcon({ size = 14 }: IconProps) {
  return (
    <Icon size={size}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
  );
}
