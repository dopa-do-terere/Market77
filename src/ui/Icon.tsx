import type { SVGProps } from "react";

const paths = {
  dashboard: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  market: "M3 10V5h18v5 M3 5l2-3h14l2 3 M2 10a2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 2.5 2.5 0 0 0 5 0 M4 13v8h16v-8 M9 21v-7h6v7",
  product: "m12 3 9 5-9 5-9-5 9-5z M3 8v9l9 5 9-5V8 M12 13v9 M7.5 5.5l9 5",
  scan: "M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5 M7 7v10 M10 7v10 M14 7v10 M17 7v10",
  sales: "M5 3h14v18l-3-2-4 2-4-2-3 2V3z M9 7h6 M9 11h6 M9 15h3",
  terminal: "M5 3h14v13H5z M9 16v5 M15 16v5 M7 21h10 M9 7h6 M9 11h3",
  payment: "M3 5h18v14H3z M3 9h18 M7 15h3",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
  arrow: "M5 12h14 M13 6l6 6-6 6",
  plus: "M12 5v14 M5 12h14",
  check: "m5 12 4 4L19 6",
  warning: "m12 3 10 18H2L12 3z M12 9v4 M12 17h.01",
  logout: "M9 3H3v18h6 M9 12h12 M17 8l4 4-4 4",
  menu: "M4 6h16 M4 12h16 M4 18h16",
  close: "m6 6 12 12 M6 18 18 6",
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, ...props }: SVGProps<SVGSVGElement> & { name: IconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>
      <path d={paths[name]} />
    </svg>
  );
}
