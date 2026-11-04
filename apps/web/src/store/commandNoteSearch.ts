import type { CommandNoteSearcher } from '@study-accelerator/web-core';

/** optional 能力保留旧宿主兼容；命令请求始终绑定 store 的当前空间。 */
export function bindCommandNoteSearch(search: CommandNoteSearcher | undefined, currentSpaceId: () => string | null): CommandNoteSearcher | undefined {
  if (!search) return undefined;
  return async input => {
    if (!input.spaceId || input.spaceId !== currentSpaceId()) throw new Error('搜索空间已切换，请重新输入关键字。');
    const hits = await search(input);
    if (input.spaceId !== currentSpaceId()) throw new Error('搜索空间已切换，请重新输入关键字。');
    return hits;
  };
}
