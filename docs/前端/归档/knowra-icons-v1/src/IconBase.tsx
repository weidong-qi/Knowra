import { forwardRef, type ReactNode } from "react";
import type { KnowraIconProps } from "./types";

export const ACCENT = "var(--knowra-icon-accent, currentColor)";

type IconBaseProps = KnowraIconProps & { children: ReactNode };

export const IconBase = forwardRef<SVGSVGElement, IconBaseProps>(function IconBase(
  { size = 24, title, decorative, strokeWidth = 1.75, children, ...props },
  ref,
) {
  const labelled = Boolean(title || props["aria-label"]);
  const ariaHidden = decorative ?? !labelled;

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      focusable="false"
      aria-hidden={ariaHidden ? true : undefined}
      role={ariaHidden ? undefined : "img"}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
});
