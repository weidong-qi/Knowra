import { createIcon } from '../createIcon';
import { Fit, OWN_STROKE } from './fit';

/**
 * 左侧导航栏与手机底栏专用的图标。
 * 规则：描边 1.45（图形放大 1.12 倍后约等于 1.6），端点圆角，节点之间留固定缝，
 * 每个图标只有一处橙色签名（叶子、橙线、亮点、对勾、微笑）。
 * 通用图标（NoteIcon、SearchIcon 等）仍用于列表、树和检查器，不在此替换。
 */
const SIGN = 'var(--accent, #f26b1d)';
const ROOT_STROKE = OWN_STROKE;

/** 首页：小橙。 */
export const RailHomeIcon = createIcon(
  'RailHomeIcon',
  <Fit>
    <ellipse cx="12" cy="13.6" rx="8.4" ry="7.5" />
    <path d="M12.1 6.2c-.3-2.9 1.9-4.6 5.4-4.3.2 3.4-2 5-5.4 4.3Z" fill={SIGN} stroke="none" />
    <path d="M7.6 12.4a4.6 4.6 0 0 1 3-3.4" opacity=".55" />
  </Fit>,
  ROOT_STROKE
);

export const RailSearchIcon = createIcon(
  'RailSearchIcon',
  <Fit>
    <circle cx="10.5" cy="10.5" r="6.6" />
    <path d="m15.4 15.4 5 5" />
    <path d="M7.6 9.6a3.2 3.2 0 0 1 2.2-2.2" stroke={SIGN} />
  </Fit>,
  ROOT_STROKE
);

/** 资料：叠放的纸页，和笔记卡封面里的纸同形。 */
export const RailNoteIcon = createIcon(
  'RailNoteIcon',
  <Fit>
    <path d="M9.2 3.4h6.2l4.2 4.2v5.6" opacity=".55" />
    <path d="M7 6.2h6.2l4.8 4.8v8.2a1.7 1.7 0 0 1-1.7 1.7H7a1.7 1.7 0 0 1-1.7-1.7V7.9A1.7 1.7 0 0 1 7 6.2Z" />
    <path d="M13.2 6.2V11H18" />
    <path d="M8.6 14.6h6.2" />
    <path d="M8.6 17.6h3.4" stroke={SIGN} />
  </Fit>,
  ROOT_STROKE
);

/** 知识：四颗相连的星加两颗散点，末端一颗是橙色。 */
export const RailKnowledgeIcon = createIcon(
  'RailKnowledgeIcon',
  <Fit>
    <path d="M5.2 16.6 9.6 10.2 14.8 13.4" opacity=".55" />
    <path d="M14.8 13.4 18.8 5.6" stroke={SIGN} />
    <circle cx="5.2" cy="16.8" r="2" />
    <circle cx="9.6" cy="10" r="2.5" />
    <circle cx="14.8" cy="13.6" r="1.9" />
    <circle cx="18.8" cy="5.4" r="2.1" fill={SIGN} stroke="none" />
    <circle cx="6.2" cy="6.4" r="1.1" fill="currentColor" stroke="none" />
    <circle cx="19.6" cy="18.6" r="1" fill="currentColor" stroke="none" />
  </Fit>,
  ROOT_STROKE
);

/** 试题：一张纸上的问号。 */
export const RailQuestionIcon = createIcon(
  'RailQuestionIcon',
  <Fit>
    <rect x="4.4" y="3.4" width="15.2" height="17.2" rx="2.6" />
    <path d="M9.7 9.6a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.2 1-1.2 1.8" />
    <circle cx="12" cy="16.5" r="1.05" fill={SIGN} stroke="none" />
  </Fit>,
  ROOT_STROKE
);

/** 任务：清单，第一项已完成。 */
export const RailTaskIcon = createIcon(
  'RailTaskIcon',
  <Fit>
    <rect x="4.4" y="4.4" width="6.2" height="6.2" rx="1.7" />
    <path d="m6.1 7.6 1.4 1.4 2-2.5" stroke={SIGN} />
    <path d="M13.6 7.5h6" />
    <rect x="4.4" y="13.4" width="6.2" height="6.2" rx="1.7" />
    <path d="M13.6 16.5h4.2" />
  </Fit>,
  ROOT_STROKE
);

/** AI 助手：带两只眼睛和橙色微笑的对话框，不用四角星。 */
export const RailAssistantIcon = createIcon(
  'RailAssistantIcon',
  <Fit>
    <path d="M6 4.4h12a2.4 2.4 0 0 1 2.4 2.4v8.2a2.4 2.4 0 0 1-2.4 2.4h-6.6L7 21.2v-3.8H6A2.4 2.4 0 0 1 3.6 15V6.8A2.4 2.4 0 0 1 6 4.4Z" />
    <circle cx="9.2" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="14.8" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <path d="M10 12.9q2 1.7 4 0" stroke={SIGN} />
  </Fit>,
  ROOT_STROKE
);

export const RailUserIcon = createIcon(
  'RailUserIcon',
  <Fit>
    <circle cx="12" cy="8.4" r="3.8" />
    <path d="M4.8 20.4c.7-3.6 3.5-5.7 7.2-5.7s6.5 2.1 7.2 5.7" />
  </Fit>,
  ROOT_STROKE
);
