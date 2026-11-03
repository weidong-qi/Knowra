import { forwardRef, type ReactNode } from "react";
import { IconBase } from "./IconBase";
import type { KnowraIconProps } from "./types";

/** baseStroke：个别图标（加粗、斜体）需要更粗的描边；调用方显式传入 strokeWidth 时优先。 */
export function createIcon(displayName: string, glyph: ReactNode, baseStroke?: number) {
  const Icon = forwardRef<SVGSVGElement, KnowraIconProps>(function KnowraIcon(props, ref) {
    return (
      <IconBase ref={ref} strokeWidth={baseStroke} {...props}>
        {glyph}
      </IconBase>
    );
  });
  Icon.displayName = displayName;
  return Icon;
}
