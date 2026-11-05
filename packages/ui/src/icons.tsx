import type { ReactNode } from 'react';

import { cn } from './cn.js';

export interface IconProps {
  className?: string;
}

function Svg({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={cn('size-5 shrink-0', className)}
    >
      {children}
    </svg>
  );
}

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Svg>
);
export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
  </Svg>
);
export const IconMonitor = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </Svg>
);
export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Svg>
);
export const IconUser = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Svg>
);
export const IconLogOut = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 16l4-4-4-4M20 12H9" />
  </Svg>
);
export const IconEye = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const IconEyeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M10.6 5.6A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.4-1.1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
  </Svg>
);
export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" />
  </Svg>
);
export const IconLaptop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="11" rx="1.5" />
    <path d="M2.5 19h19" />
  </Svg>
);
export const IconPhone = (p: IconProps) => (
  <Svg {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </Svg>
);
export const IconMail = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3.5 6.5 8.5 6.5 8.5-6.5" />
  </Svg>
);
export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Svg>
);
export const IconDisc = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="2.5" />
  </Svg>
);
export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Svg>
);
export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z"
      fill="currentColor"
      stroke="none"
    />
  </Svg>
);
export const IconPause = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconNext = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M6 6.5v11a.8.8 0 0 0 1.2.7l8.3-5.5a.8.8 0 0 0 0-1.4L7.2 5.8A.8.8 0 0 0 6 6.5Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M18 6v12" />
  </Svg>
);
export const IconPrevious = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M18 6.5v11a.8.8 0 0 1-1.2.7l-8.3-5.5a.8.8 0 0 1 0-1.4l8.3-5.5A.8.8 0 0 1 18 6.5Z"
      fill="currentColor"
      stroke="none"
    />
    <path d="M6 6v12" />
  </Svg>
);
export const IconShuffle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h3.5a4 4 0 0 1 3.2 1.6l4.6 6.8A4 4 0 0 0 17.5 17H21M3 17h3.5a4 4 0 0 0 3.2-1.6l.8-1.2M14.3 8.6l.2-.2A4 4 0 0 1 17.5 7H21M18 4l3 3-3 3M18 14l3 3-3 3" />
  </Svg>
);
export const IconRepeat = (p: IconProps) => (
  <Svg {...p}>
    <path d="m17 3 3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />
  </Svg>
);
export const IconRepeatOne = (p: IconProps) => (
  <Svg {...p}>
    <path d="m17 3 3 3-3 3M4 11V9a3 3 0 0 1 3-3h13M7 21l-3-3 3-3M20 13v2a3 3 0 0 1-3 3H4" />
    <path d="M11 10.5 12.5 9.5v5" />
  </Svg>
);
export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Svg>
);
export const IconVolumeMute = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </Svg>
);
export const IconQueue = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h12M4 12h12M4 18h7" />
    <path d="M16 14.5v6l4.5-3z" fill="currentColor" />
  </Svg>
);
export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
);
export const IconChevronUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="m6 15 6-6 6 6" />
  </Svg>
);
export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);
export const IconBack10 = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12A7.5 7.5 0 1 0 6.7 6.7M4.5 3.5v4h4" />
    <text
      x="12.5"
      y="15.2"
      fontSize="7"
      fontWeight="700"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
    >
      10
    </text>
  </Svg>
);
export const IconForward10 = (p: IconProps) => (
  <Svg {...p}>
    <path d="M19.5 12A7.5 7.5 0 1 1 17.3 6.7M19.5 3.5v4h-4" />
    <text
      x="11.5"
      y="15.2"
      fontSize="7"
      fontWeight="700"
      textAnchor="middle"
      fill="currentColor"
      stroke="none"
    >
      10
    </text>
  </Svg>
);
export const IconBars = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 18v-7M10 18V6M14 18v-9M18 18v-5" />
  </Svg>
);
export const IconSparkle = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5 13.8 9 19.5 10.5 13.8 12 12 17.5 10.2 12 4.5 10.5 10.2 9Z" />
    <path d="M18.5 3v3M17 4.5h3" />
  </Svg>
);
export const IconHeart = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z" />
  </Svg>
);
export const IconHeartFilled = (p: IconProps) => (
  <Svg {...p}>
    <path
      d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.3a4.3 4.3 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20Z"
      fill="currentColor"
    />
  </Svg>
);
export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconLibrary = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 4v16M9.5 4v16M14 4.5l5 15" />
  </Svg>
);
