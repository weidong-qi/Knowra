import type { SVGProps } from "react";

export type KnowraIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Icon box size. Defaults to 24. */
  size?: number | string;
  /** Optional accessible title. aria-label is also supported. */
  title?: string;
  /** Force aria-hidden when the icon is purely decorative. */
  decorative?: boolean;
};
