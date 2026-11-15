import { forwardRef, useId, type ReactNode } from 'react';
import { IconBase } from '../IconBase';
import { createIcon } from '../createIcon';
import type { KnowraIconProps } from '../types';

/**
 * 左侧导航栏与手机底栏专用的实心镂空图标（纯净实心方案）。
 * 通过 SVG <mask> 生成透明负形细节，搭配 opacity 叠层表达层次，适应亮暗色及任意主题色 --accent。
 * 通用图标（NoteIcon、SearchIcon、BellIcon、SettingsIcon 等）仍用于列表、树和展台，不在此替换。
 */

/** 生成实例隔离的 SVG mask ID，避免桌面左轨与移动端底栏同时挂载时 id 冲突。 */
function createMaskedIcon(displayName: string, renderGlyph: (maskPrefix: string) => ReactNode) {
  const Icon = forwardRef<SVGSVGElement, KnowraIconProps>(function MaskedKnowraIcon(props, ref) {
    const maskId = `kr-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return (
      <IconBase ref={ref} {...props}>
        {renderGlyph(maskId)}
      </IconBase>
    );
  });
  Icon.displayName = displayName;
  return Icon;
}

/** 首页：知境晶核实心方印（源自 Knowra 图形标志）。 */
export const RailHomeIcon = createMaskedIcon('RailHomeIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect x="6.4" y="6.4" width="11.2" height="11.2" rx="2.7" fill="#000" />
        <rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1.4" fill="#fff" />
      </mask>
    </defs>
    <rect x="3" y="3" width="18" height="18" rx="5.5" fill="currentColor" stroke="none" mask={`url(#${id})`} />
  </>
));

export const RailSearchIcon = createMaskedIcon('RailSearchIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="10.4" cy="10.4" r="3.7" fill="#000" />
      </mask>
    </defs>
    <circle cx="10.4" cy="10.4" r="3.7" fill="currentColor" stroke="none" opacity={0.16} />
    <circle cx="10.4" cy="10.4" r="6.8" fill="currentColor" stroke="none" mask={`url(#${id})`} />
    <path d="M15.4 15.4 19.7 19.7" stroke="currentColor" strokeWidth={2.9} strokeLinecap="round" />
  </>
));

/** 资料：叠放的实心纸页，保留前页折角与后页透明隔离缝。 */
export const RailNoteIcon = createMaskedIcon('RailNoteIcon', id => (
  <>
    <defs>
      <mask id={`${id}-front`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <path d="M13.3 5.2v3.6a1.1 1.1 0 0 0 1.1 1.1h3.6" fill="none" stroke="#000" strokeWidth={2.5} />
        <path d="M14.2 5.2l3.8 3.8v-4h-4Z" fill="#000" />
        <rect x="7.4" y="12.2" width="6.8" height="1.65" rx="0.82" fill="#000" />
        <rect x="7.4" y="15.6" width="4.5" height="1.65" rx="0.82" fill="#000" />
      </mask>
      <mask id={`${id}-back`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect x="3.5" y="4.3" width="14.9" height="17.6" rx="3.4" fill="#000" />
      </mask>
    </defs>
    <g stroke="none">
      <rect
        x="7.4"
        y="3.0"
        width="12.2"
        height="15.0"
        rx="2.6"
        fill="currentColor"
        opacity={0.36}
        mask={`url(#${id}-back)`}
      />
      <rect x="4.6" y="5.4" width="12.6" height="15.4" rx="2.8" fill="currentColor" mask={`url(#${id}-front)`} />
      <path d="M13.7 5.55 17.05 8.9H14.5a.8.8 0 0 1-.8-.8V5.55Z" fill="currentColor" opacity={0.45} />
    </g>
  </>
));

/** 知识：星团图谱（一大两小实心节点 + 连桥两端透明隔离缝）。 */
export const RailKnowledgeIcon = createMaskedIcon('RailKnowledgeIcon', id => (
  <>
    <defs>
      <mask id={`${id}-links`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="16.2" cy="7.2" r="4.65" fill="#000" />
        <circle cx="6.0" cy="11.2" r="3.8" fill="#000" />
        <circle cx="14.0" cy="17.8" r="3.9" fill="#000" />
      </mask>
      <mask id={`${id}-hero`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="16.2" cy="7.2" r="1.45" fill="#000" />
      </mask>
    </defs>
    <path
      d="M6.0 11.2L16.2 7.2L14.0 17.8Z"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.46}
      mask={`url(#${id}-links)`}
    />
    <g stroke="none">
      <circle cx="16.2" cy="7.2" r="3.7" fill="currentColor" mask={`url(#${id}-hero)`} />
      <circle cx="6.0" cy="11.2" r="2.85" fill="currentColor" />
      <circle cx="14.0" cy="17.8" r="2.95" fill="currentColor" />
    </g>
  </>
));

/** 试题：圆角实心题卡 + 负形问号。 */
export const RailQuestionIcon = createMaskedIcon('RailQuestionIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <path
          d="M9.55 9.15a2.55 2.55 0 1 1 3.75 2.2c-.85.5-1.3.95-1.3 1.8"
          fill="none"
          stroke="#000"
          strokeWidth={2.1}
          strokeLinecap="round"
        />
        <circle cx="12" cy="16.6" r="1.25" fill="#000" />
      </mask>
    </defs>
    <rect x="4.8" y="3.4" width="14.4" height="17.2" rx="3.4" fill="currentColor" stroke="none" mask={`url(#${id})`} />
  </>
));

/** 任务：带顶夹与透明卡槽的实心剪贴板。 */
export const RailTaskIcon = createMaskedIcon('RailTaskIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect x="7.5" y="1.8" width="9.0" height="5.5" rx="2.2" fill="#000" />
        <path
          d="m7.9 11.4 1.15 1.15 2.15-2.2"
          fill="none"
          stroke="#000"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="12.7" y="10.65" width="3.7" height="1.6" rx="0.8" fill="#000" />
        <rect x="7.8" y="15.0" width="8.4" height="1.6" rx="0.8" fill="#000" />
      </mask>
    </defs>
    <g stroke="none">
      <rect x="5.0" y="4.8" width="14.0" height="16.0" rx="3.1" fill="currentColor" mask={`url(#${id})`} />
      <rect x="8.7" y="2.8" width="6.6" height="3.3" rx="1.35" fill="currentColor" />
    </g>
  </>
));

/** 待办：保留日历+对勾语义，顶部装订耳与浅透月历头结合负形对勾。 */
export const RailTodoIcon = createMaskedIcon('RailTodoIcon', id => (
  <>
    <defs>
      <mask id={`${id}-top`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <rect x="6.9" y="2.4" width="3.6" height="4.2" rx="1.5" fill="#000" />
        <rect x="13.5" y="2.4" width="3.6" height="4.2" rx="1.5" fill="#000" />
      </mask>
      <mask id={`${id}-body`} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <path
          d="m8.7 15.0 2.15 2.15 4.45-4.5"
          fill="none"
          stroke="#000"
          strokeWidth={2.15}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </mask>
    </defs>
    <g stroke="none">
      <rect x="7.6" y="3.0" width="2.2" height="3.1" rx="1.1" fill="currentColor" />
      <rect x="14.2" y="3.0" width="2.2" height="3.1" rx="1.1" fill="currentColor" />
      <path
        d="M4.4 7.8A2.8 2.8 0 0 1 7.2 5h9.6a2.8 2.8 0 0 1 2.8 2.8V9H4.4V7.8Z"
        fill="currentColor"
        opacity={0.44}
        mask={`url(#${id}-top)`}
      />
      <path
        d="M4.4 10.1h15.2v7.3a3.2 3.2 0 0 1-3.2 3.2H7.6a3.2 3.2 0 0 1-3.2-3.2v-7.3Z"
        fill="currentColor"
        mask={`url(#${id}-body)`}
      />
    </g>
  </>
));

/** AI 助手：带负形眼睛和微笑的圆润实心对话框，不用四角星。 */
export const RailAssistantIcon = createMaskedIcon('RailAssistantIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="9.2" cy="9.9" r="1.2" fill="#000" />
        <circle cx="14.8" cy="9.9" r="1.2" fill="#000" />
        <path d="M9.2 13.0q2.8 2.4 5.6 0" fill="none" stroke="#000" strokeWidth={1.95} strokeLinecap="round" />
      </mask>
    </defs>
    <path
      d="M7.2 4.3h9.6a3.9 3.9 0 0 1 3.9 3.9v6.2a3.9 3.9 0 0 1-3.9 3.9h-5.4l-3.7 2.75a.85.85 0 0 1-1.36-.68v-2.07H7.2a3.9 3.9 0 0 1-3.9-3.9V8.2a3.9 3.9 0 0 1 3.9-3.9Z"
      fill="currentColor"
      stroke="none"
      mask={`url(#${id})`}
    />
  </>
));

/** 通知：实心圆润钟罩 + 浅透钟锤。 */
export const RailBellIcon = createIcon(
  'RailBellIcon',
  <g stroke="none">
    <circle cx="12" cy="3.9" r="1.2" fill="currentColor" />
    <path
      d="M12 4.7c-3.35 0-5.4 2.25-5.4 5.5v2.9c0 .75-.32 1.45-.86 1.95l-.84.78a1 1 0 0 0 .68 1.72h12.84a1 1 0 0 0 .68-1.72l-.84-.78a2.7 2.7 0 0 1-.86-1.95v-2.9c0-3.25-2.05-5.5-5.4-5.5Z"
      fill="currentColor"
    />
    <path d="M9.6 18.8a2.55 2.55 0 0 0 4.8 0Z" fill="currentColor" opacity={0.48} />
  </g>
);

/** 账户与设置：圆润实心头像与肩部胶囊。 */
export const RailUserIcon = createIcon(
  'RailUserIcon',
  <g stroke="none">
    <circle cx="12" cy="7.9" r="3.75" fill="currentColor" />
    <path
      d="M4.9 19.6c.2-3.4 3.2-5.5 7.1-5.5s6.9 2.1 7.1 5.5a1.45 1.45 0 0 1-1.45 1.5H6.35A1.45 1.45 0 0 1 4.9 19.6Z"
      fill="currentColor"
    />
  </g>
);

/** 手机端底栏设置：六齿圆润实心齿轮 + 负形中心孔。 */
export const RailSettingsIcon = createMaskedIcon('RailSettingsIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect x="0" y="0" width="24" height="24" fill="#fff" />
        <circle cx="12" cy="12" r="3.15" fill="#000" />
      </mask>
    </defs>
    <g fill="currentColor" stroke="none" mask={`url(#${id})`}>
      <circle cx="12" cy="12" r="6.85" />
      <rect x="9.8" y="3.0" width="4.4" height="18.0" rx="2.0" />
      <rect x="9.8" y="3.0" width="4.4" height="18.0" rx="2.0" transform="rotate(60 12 12)" />
      <rect x="9.8" y="3.0" width="4.4" height="18.0" rx="2.0" transform="rotate(120 12 12)" />
    </g>
  </>
));
