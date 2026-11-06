import { useId } from 'react';
import type { FolderArt } from './notesIndexAppearanceModel';
import styles from './NotesIndexItems.module.css';

/**
 * 卡片视图文件夹右侧插画。五套风格各自独立绘制，左侧信息区由卡片渐变承接。
 * 默认「手绘线稿」；其余风格可在设置 → 外观 → 文件夹卡片插画 中切换。
 */
export function FolderCardArt({ style }: { style: FolderArt }) {
  const uid = useId().replace(/:/g, '');
  return (
    <svg
      className={styles.folderArt}
      viewBox="0 0 160 184"
      preserveAspectRatio="xMaxYMid slice"
      aria-hidden="true"
      focusable="false"
      data-folder-art={style}
    >
      {style === 'mountain' ? <Mountain id={uid} /> : null}
      {style === 'sketch' ? <Sketch id={uid} /> : null}
      {style === 'sticky' ? <Sticky id={uid} /> : null}
      {style === 'sprout' ? <Sprout id={uid} /> : null}
      {style === 'night' ? <Night id={uid} /> : null}
    </svg>
  );
}

const FOLDER_BACK = 'M3.5 7.3V6a2 2 0 0 1 2-2h4.1l2 2.3h6.9a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z';
const FOLDER_FRONT = 'M3.5 9a1 1 0 0 1 1-1h15a1 1 0 0 1 1 1v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z';

function Shadow({ id }: { id: string }) {
  return (
    <filter id={`${id}-fs`} x="-30%" y="-30%" width="160%" height="170%">
      <feDropShadow dx="0" dy="5" stdDeviation="4" floodColor="#000" floodOpacity=".35" />
    </filter>
  );
}

function Mountain({ id }: { id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-sun`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff3d1" />
          <stop offset=".6" stopColor="#ffd58a" />
          <stop offset="1" stopColor="#ffb86b" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5a8c94" />
          <stop offset="1" stopColor="#3c6e77" />
        </linearGradient>
        <linearGradient id={`${id}-mid`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2f5c63" />
          <stop offset="1" stopColor="#22484f" />
        </linearGradient>
        <linearGradient id={`${id}-fo`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffa05a" />
          <stop offset="1" stopColor="#f26b1d" />
        </linearGradient>
        <linearGradient id={`${id}-fb`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#e0581a" />
          <stop offset="1" stopColor="#c4510c" />
        </linearGradient>
        <Shadow id={id} />
      </defs>
      <circle cx="122" cy="52" r="40" fill={`url(#${id}-sun)`} opacity=".45" />
      <circle cx="122" cy="52" r="18" fill="#ffe7a8" />
      <path
        d="M20 132 L52 96 L70 114 L96 80 L124 116 L140 104 L160 124 L160 184 L20 184 Z"
        fill={`url(#${id}-far)`}
        opacity=".9"
      />
      <path d="M96 80 L104 92 L98 90 Z" fill="#fff" opacity=".35" />
      <path d="M0 150 Q44 118 90 136 T160 130 L160 184 L0 184 Z" fill={`url(#${id}-mid)`} />
      <path d="M0 170 Q60 146 118 160 T160 158 L160 184 L0 184 Z" fill="#1c3f46" />
      <g filter={`url(#${id}-fs)`} transform="translate(84 116) scale(2.7)">
        <path d={FOLDER_BACK} fill={`url(#${id}-fb)`} />
        <path d={FOLDER_FRONT} fill={`url(#${id}-fo)`} />
        <path d="M6 10h12" stroke="#fff" opacity=".4" strokeWidth=".35" />
      </g>
    </>
  );
}

function Sketch({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-blob`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc48a" />
          <stop offset="1" stopColor="#f4a261" />
        </linearGradient>
      </defs>
      <path
        d="M84 96 C96 84 130 86 146 98 C156 108 150 150 138 164 C124 178 92 176 84 160 C76 144 74 108 84 96 Z"
        fill={`url(#${id}-blob)`}
        opacity=".38"
      />
      <g fill="none" stroke="#fff3e4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M92 60 q10 -7 20 0 t20 0" strokeWidth="1.8" opacity=".75" />
        <path d="M104 40 q6 -4 12 0" strokeWidth="1.6" opacity=".55" />
        <path d="M114 128 c-2 -7 3 -11 8 -7 s6 9 0 12" strokeWidth="1.8" opacity=".85" />
        <path d="M126 150 q6 -10 12 -2 q6 8 14 2" strokeWidth="1.8" opacity=".8" />
        <path d="M80 118 l-10 -3 M80 128 l-12 1" strokeWidth="1.6" opacity=".6" />
      </g>
      <g transform="translate(96 84) rotate(-6)">
        <path d="M2 1 L40 0 L41 30 L3 31 Z" fill="#fff3e4" opacity=".92" />
        <path
          d="M8 9 q8 -3 16 0 t14 0"
          stroke="#8d4a25"
          strokeWidth="1.4"
          fill="none"
          strokeLinecap="round"
          opacity=".7"
        />
        <path d="M8 18 h24 M8 24 h18" stroke="#8d4a25" strokeWidth="1.2" strokeLinecap="round" opacity=".45" />
      </g>
      <g
        transform="translate(92 112) scale(2.4)"
        fill="none"
        stroke="#fff3e4"
        strokeWidth=".9"
        strokeLinejoin="round"
        strokeLinecap="round"
      >
        <path d="M3.4 7.6 q-.2 -1.6 1.4 -1.8 h4.2 l2 2.1 h7.2 q1.8 0 1.8 1.8 v9.2 q0 1.8 -1.8 1.8 h-13.4 q-1.8 0 -1.8 -1.8 Z" />
        <path d="M3.9 10.2 q6 .4 16.4 -.2" opacity=".6" />
      </g>
    </>
  );
}

function Sticky({ id }: { id: string }) {
  return (
    <>
      <defs>
        <Shadow id={id} />
      </defs>
      <g filter={`url(#${id}-fs)`}>
        <g transform="rotate(-9 104 60)">
          <rect x="84" y="40" width="40" height="40" rx="3" fill="#ffd166" />
          <path d="M92 54h24M92 62h16" stroke="#7a5a10" strokeWidth="2.2" strokeLinecap="round" />
        </g>
        <g transform="rotate(7 142 50)">
          <rect x="124" y="30" width="32" height="32" rx="3" fill="#7ee0c3" />
          <path d="M130 42h20M130 50h12" stroke="#1d5c4a" strokeWidth="2.2" strokeLinecap="round" />
        </g>
        <g transform="rotate(-4 136 146)">
          <rect x="112" y="128" width="38" height="34" rx="3" fill="#ff9ec7" />
          <circle cx="131" cy="142" r="6" fill="#fff" opacity=".7" />
        </g>
      </g>
      <g fill="#fff" opacity=".45">
        <rect x="96" y="34" width="16" height="6" transform="rotate(-20 104 37)" />
        <rect x="126" y="26" width="14" height="5" transform="rotate(12 133 28)" />
      </g>
      <g transform="translate(78 100)" filter={`url(#${id}-fs)`}>
        <g transform="scale(2.6)">
          <path d={FOLDER_BACK} fill="#c4510c" />
          <path d={FOLDER_FRONT} fill="#f26b1d" />
        </g>
      </g>
    </>
  );
}

function Sprout({ id }: { id: string }) {
  return (
    <>
      <defs>
        <linearGradient id={`${id}-leaf`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#d9f5b0" />
          <stop offset="1" stopColor="#7fc17a" />
        </linearGradient>
        <radialGradient id={`${id}-ground`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#000" stopOpacity=".35" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </radialGradient>
        <Shadow id={id} />
      </defs>
      <ellipse cx="108" cy="170" rx="50" ry="8" fill={`url(#${id}-ground)`} />
      <path d="M108 124 C104 104 106 88 112 74" stroke="#d9f5b0" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <path d="M112 90 C122 74 136 74 142 80 C136 94 122 98 112 90 Z" fill={`url(#${id}-leaf)`} />
      <path d="M112 90 C122 84 130 82 138 80" stroke="#4f9a5f" strokeWidth=".8" fill="none" opacity=".7" />
      <path d="M111 78 C100 66 90 68 86 76 C96 86 106 84 111 78 Z" fill="#7fc17a" />
      <path d="M111 78 C101 72 94 73 90 75" stroke="#4f9a5f" strokeWidth=".8" fill="none" opacity=".7" />
      <circle cx="112" cy="64" r="5" fill="#d9f5b0" opacity=".85" />
      <g transform="translate(82 112) scale(2.5)" filter={`url(#${id}-fs)`}>
        <path d={FOLDER_BACK} fill="#3e8f63" />
        <path d={FOLDER_FRONT} fill="#4fa374" />
      </g>
      <circle cx="140" cy="46" r="2.4" fill="#fff" opacity=".7" />
      <circle cx="122" cy="30" r="1.6" fill="#fff" opacity=".5" />
    </>
  );
}

function Night({ id }: { id: string }) {
  return (
    <>
      <defs>
        <radialGradient id={`${id}-moon`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#fff9e0" />
          <stop offset="1" stopColor="#fff6d6" />
        </radialGradient>
        <radialGradient id={`${id}-glow`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#b7c3ff" stopOpacity=".45" />
          <stop offset="1" stopColor="#b7c3ff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}-ridge`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1b2448" />
          <stop offset="1" stopColor="#0f1530" />
        </linearGradient>
        <mask id={`${id}-mm`}>
          <rect width="160" height="184" fill="#fff" />
          <circle cx="142" cy="38" r="12" fill="#000" />
        </mask>
        <Shadow id={id} />
      </defs>
      <circle cx="132" cy="38" r="30" fill={`url(#${id}-glow)`} />
      <circle cx="132" cy="38" r="13" fill={`url(#${id}-moon)`} mask={`url(#${id}-mm)`} />
      <g fill="#fff">
        <circle cx="106" cy="66" r="1.2" opacity=".9" />
        <circle cx="150" cy="82" r="1" opacity=".7" />
        <circle cx="92" cy="30" r="1" opacity=".8" />
        <circle cx="120" cy="100" r=".9" opacity=".6" />
        <circle cx="60" cy="50" r="1.1" opacity=".7" />
        <circle cx="78" cy="84" r=".8" opacity=".5" />
      </g>
      <path d="M48 184 Q84 128 160 136 L160 184 Z" fill={`url(#${id}-ridge)`} />
      <path d="M48 184 Q84 128 160 136" fill="none" stroke="#b7c3ff" strokeOpacity=".35" strokeWidth="1" />
      <g filter={`url(#${id}-fs)`} transform="translate(70 96) scale(3.6)">
        <path d={FOLDER_BACK} fill="#7f8fe6" />
        <path d={FOLDER_FRONT} fill="#b7c3ff" />
        <path d="M6 10h12" stroke="#fff" opacity=".45" strokeWidth=".4" />
      </g>
    </>
  );
}
