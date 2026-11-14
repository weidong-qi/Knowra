import { forwardRef, type ReactNode } from "react";
import { IconBase } from "./IconBase";
import type { KnowraIconProps } from "./types";

export function createIcon(displayName: string, glyph: ReactNode) {
  const Icon = forwardRef<SVGSVGElement, KnowraIconProps>(function KnowraIcon(props, ref) {
    return (
      <IconBase ref={ref} {...props}>
        {glyph}
      </IconBase>
    );
  });
  Icon.displayName = displayName;
  return Icon;
}
