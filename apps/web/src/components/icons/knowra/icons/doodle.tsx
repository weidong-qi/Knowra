// 手绘涂鸦图标：线条故意带一点不规则与出头，下面垫一块错位的色块（data-blob），
// 色块颜色与透明度由使用处的 CSS 决定（默认取 --knowra-doodle-fill，否则为强调色）。
// 目前用于左侧导航；与首页的手绘涂鸦首屏保持同一气质。

import { createIcon } from '../createIcon';

const BLOB_STYLE = { fill: 'var(--knowra-doodle-fill, var(--accent, #f26b1d))', stroke: 'none' } as const;
const BLOB_SHIFT = 'translate(1.3 1.4)';

function Blob({ d }: { d: string }) {
  return <path data-blob="" d={d} style={BLOB_STYLE} transform={BLOB_SHIFT} />;
}

export const DoodleHomeIcon = createIcon(
  'DoodleHomeIcon',
  <>
    <Blob d="M5.6 10.6 L12 5 L18.6 10.6 L18.8 20 L5.4 20 Z" />
    <path d="M3.4 11.6 L12.2 3.6 L20.7 11.3" />
    <path d="M5.7 10.3 L5.3 19.7 Q5.3 20.5 6 20.4 L18.1 20.6 Q18.9 20.6 18.8 19.8 L18.5 10.5" />
    <path d="M10.1 20.5 L10.2 14.7 L13.7 14.5 L13.9 20.4" />
  </>,
  2
);

export const DoodleSearchIcon = createIcon(
  'DoodleSearchIcon',
  <>
    <Blob d="M10.6 4.8 C14 4.4 17 7 16.8 10.6 C16.6 14 13.7 16.4 10.4 16.2 C7 16 4.7 13 5 9.8 C5.3 7 7.6 5 10.6 4.8 Z" />
    <path d="M10.6 4.4 C14 4.1 17.2 6.9 16.9 10.5 C16.7 14 13.7 16.6 10.3 16.3 C6.9 16 4.4 13 4.8 9.7 C5.1 6.8 7.5 4.7 10.6 4.4 Z" />
    <path d="M15.1 14.9 L20.6 20.5" />
  </>,
  2.1
);

export const DoodleNoteIcon = createIcon(
  'DoodleNoteIcon',
  <>
    <Blob d="M7.1 3.9 L14.4 3.6 L18.6 7.8 L18.4 19.8 L7 20 Z" />
    <path d="M7 3.7 L14.5 3.4 L18.8 7.7 L18.6 19.9 Q18.6 20.7 17.8 20.7 L7.1 20.5 Q6.3 20.5 6.4 19.7 Z" />
    <path d="M14.2 3.6 L14.6 8.1 L18.9 7.9" />
    <path d="M9.1 12.5 L15.7 12.2" />
    <path d="M9 16.3 L13.5 16.4" />
  </>,
  2
);

export const DoodleKnowledgeIcon = createIcon(
  'DoodleKnowledgeIcon',
  <>
    <Blob d="M12 3.9 L20 8.3 L12.1 12.3 L4 8.2 Z" />
    <path d="M12 3.5 L20.4 8.2 L12.2 12.6 L3.6 8 Z" />
    <path d="M3.9 12.1 L12 16.5 L20.2 11.9" />
    <path d="M4.1 15.8 L12.1 20.3 L20 15.7" />
  </>,
  2
);

export const DoodleQuestionIcon = createIcon(
  'DoodleQuestionIcon',
  <>
    <Blob d="M5.3 4.9 L18.8 4.7 L19.7 14.5 L13.4 15.6 L9.4 19.7 L9.3 15.7 L4.6 15.6 Z" />
    <path d="M5.2 4.6 L18.9 4.4 Q19.9 4.4 19.9 5.5 L19.7 14.5 Q19.7 15.5 18.7 15.5 L13.5 15.6 L9.5 19.8 L9.3 15.7 L5.3 15.7 Q4.3 15.7 4.3 14.7 L4.4 5.7 Q4.4 4.7 5.2 4.6 Z" />
    <path d="M9.5 9.3 C9.4 7.3 12.7 7.1 12.8 9.1 C12.8 10.6 11.4 10.6 11.3 12.1" />
    <path d="M11.3 13.7 L11.4 13.8" />
  </>,
  2
);

export const DoodleTaskIcon = createIcon(
  'DoodleTaskIcon',
  <>
    <Blob d="M12.1 4.6 C16 4.4 19.3 7.9 19.1 12 C18.9 16 15.7 19.3 11.8 19.1 C7.9 18.9 4.7 15.6 5 11.8 C5.3 8 8.3 4.8 12.1 4.6 Z" />
    <path d="M12 4.1 C16.2 3.9 19.7 7.6 19.5 11.9 C19.3 16.3 15.9 19.7 11.7 19.5 C7.5 19.3 4.2 15.8 4.5 11.6 C4.8 7.5 7.9 4.3 12 4.1 Z" />
    <path d="M7.8 12.5 L10.9 15.5 L16.8 8.6" />
  </>,
  2.1
);

export const DoodleSparkIcon = createIcon(
  'DoodleSparkIcon',
  <>
    <Blob d="M10.8 4 C11.4 7.2 12.4 8.9 16 10.3 C12.4 11.7 11.4 13.5 10.8 16.9 C10.2 13.5 9.2 11.7 5.6 10.3 C9.2 8.9 10.2 7.2 10.8 4 Z" />
    <path d="M10.8 3.6 C11.4 6.9 12.4 8.6 16.2 10.1 C12.4 11.6 11.4 13.4 10.8 16.9 C10.2 13.4 9.2 11.6 5.4 10.1 C9.2 8.6 10.2 6.9 10.8 3.6 Z" />
    <path d="M18.7 15.7 L18.5 20.9" />
    <path d="M16 18.4 L21.2 18.2" />
  </>,
  2
);

export const DoodleUserIcon = createIcon(
  'DoodleUserIcon',
  <>
    <Blob d="M12 4.6 C14.3 4.5 15.8 6.2 15.8 8.2 C15.8 10.3 14.2 11.9 12 11.9 C9.8 11.9 8.2 10.3 8.2 8.2 C8.2 6.2 9.7 4.7 12 4.6 Z" />
    <path d="M12 4.2 C14.5 4.1 16.1 6 16 8.2 C15.9 10.5 14.3 12.2 12 12.2 C9.7 12.2 7.9 10.5 7.9 8.1 C7.9 5.9 9.6 4.3 12 4.2 Z" />
    <path d="M4.7 20.3 C5.3 16.6 8.4 14.8 12 14.8 C15.6 14.8 18.7 16.6 19.3 20.3" />
  </>,
  2
);

export const DoodleBellIcon = createIcon(
  'DoodleBellIcon',
  <>
    <Blob d="M12 4.2 C8.7 4.2 7.2 6.8 7.2 9.5 L7 13.7 L5.3 16.5 L18.9 16.5 L17.2 13.7 L17 9.5 C17 6.8 15.4 4.2 12 4.2 Z" />
    <path d="M12 3.8 C8.4 3.8 6.8 6.5 6.8 9.4 L6.6 13.6 L4.8 16.4 L19.2 16.6 L17.4 13.6 L17.2 9.4 C17.2 6.5 15.6 3.8 12 3.8 Z" />
    <path d="M9.9 19 Q12 21 14.2 18.9" />
  </>,
  2
);
