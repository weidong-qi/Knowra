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

/** 资料：露出折角纸页的收纳盒，盒面留出标签槽。 */
export const RailNoteIcon = createIcon(
  'RailNoteIcon',
  <g>
    <path
      fill="currentColor"
      stroke="none"
      fillRule="evenodd"
      d="M6.1 8.7V5.2a2.5 2.5 0 0 1 2.5-2.5h7.1c.5 0 .9.2 1.2.5l3.3 3.4c.3.3.5.7.5 1.2v2.5c.3.4.4.9.4 1.5v6.1a3.3 3.3 0 0 1-3.3 3.3H6.2a3.3 3.3 0 0 1-3.3-3.3v-6.7a2.5 2.5 0 0 1 2.5-2.5h.7Z
         M8.6 3.8c-.8 0-1.4.6-1.4 1.4v5.7c0 .7.5 1.2 1.2 1.2h7.5c.6 0 1-.2 1.4-.7l.4-.6c.4-.5.8-.7 1.4-.7h.4V7.6h-2.8c-.7 0-1.2-.5-1.2-1.2V3.8H8.6Z
         M10.3 15.3a.9.9 0 0 0 0 1.8h3.4a.9.9 0 1 0 0-1.8h-3.4Z"
    />
    <path d="M10.1 6.9h3.9m-3.9 2.7H14" strokeWidth={1.25} />
  </g>
);

/** 知识：三个实心节点在中心交汇。 */
export const RailKnowledgeIcon = createIcon(
  'RailKnowledgeIcon',
  <>
    <path d="m5.6 9.6 6.5 3 5.8-5.7m-5.8 5.7 1.1 5.8" strokeWidth={1.15} />
    <g fill="currentColor" stroke="none">
      <circle cx="5.6" cy="9.6" r="3" />
      <circle cx="17.9" cy="6.9" r="3.1" />
      <circle cx="13.2" cy="18.4" r="3.1" />
    </g>
  </>
);

/** 试题：圆角实心题卡与镂空问号。 */
export const RailQuestionIcon = createMaskedIcon('RailQuestionIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <path d="M9.3 9a2.7 2.7 0 0 1 5.4 0c0 2.2-2.7 2.4-2.7 4.4" stroke="black" strokeWidth={1.95} />
        <circle cx="12" cy="16.6" r="1.1" fill="black" stroke="none" />
      </mask>
    </defs>
    <rect x="4" y="3.4" width="16" height="17.2" rx="3.1" fill="currentColor" stroke="none" mask={`url(#${id})`} />
  </>
));

/** 任务：带顶夹、勾选项和摘要线的剪贴板。 */
export const RailTaskIcon = createMaskedIcon('RailTaskIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <rect x="8" y="2" width="8" height="5.3" rx="2" fill="black" stroke="none" />
        <path d="m7.4 11.7 1.2 1.2 2.1-2.1m2.3.8h3.5M7.6 16.5h8.8" stroke="black" strokeWidth={1.6} />
      </mask>
    </defs>
    <g fill="currentColor" stroke="none">
      <rect x="4.2" y="5" width="15.6" height="16.2" rx="3.1" mask={`url(#${id})`} />
      <rect x="8.6" y="2.8" width="6.8" height="3.8" rx="1.65" />
    </g>
  </>
));

/** 待办：双装订环日历与镂空对勾。 */
export const RailTodoIcon = createMaskedIcon('RailTodoIcon', id => (
  <>
    <defs>
      <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
        <rect width="24" height="24" fill="white" stroke="none" />
        <g fill="black" stroke="none">
          <rect x="6.2" y="2" width="3.6" height="4.9" rx="1.8" />
          <rect x="14.2" y="2" width="3.6" height="4.9" rx="1.8" />
          <rect x="3" y="9" width="18" height=".9" />
        </g>
        <path d="m8.8 15.3 2.1 2.1 4.5-4.5" stroke="black" strokeWidth={2} />
      </mask>
    </defs>
    <g fill="currentColor" stroke="none">
      <rect x="3.5" y="4.6" width="17" height="16.3" rx="3" mask={`url(#${id})`} />
      <rect x="6.9" y="3" width="2.2" height="3.2" rx="1.1" />
      <rect x="14.9" y="3" width="2.2" height="3.2" rx="1.1" />
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
