# Knowra Icons v1

为 Knowra / 知境 V4 准备的 24px 线性 SVG 图标包，共 **75 个**。

## 推荐接入方式

把 `src/` 复制到：

```text
apps/web/src/components/icons/knowra/
```

然后直接引用：

```tsx
import { FolderIcon, SearchIcon, MarkdownFileIcon } from '@/components/icons/knowra';

export function Demo() {
  return (
    <div>
      <FolderIcon size={20} />
      <SearchIcon size={18} aria-label="搜索" />
      <MarkdownFileIcon className="knowra-icon--accent" />
    </div>
  );
}
```

## 颜色策略

主线条永远使用 `currentColor`，所以图标会继承按钮/菜单/文本的当前颜色。

少量强调线条使用：

```css
--knowra-icon-accent
```

可以把它映射到项目自己的 Design Token：

```css
.knowra-icon--accent {
  --knowra-icon-accent: var(--color-primary);
}
```

如果没有定义这个变量，强调线条会自动退化为 `currentColor`，图标仍然是完整的单色图标。

## 可访问性

没有 `title` / `aria-label` 时默认作为装饰图标并设置 `aria-hidden`。有文本含义时：

```tsx
<SearchIcon aria-label="搜索" />
<UploadIcon title="上传资料" />
```

## SVG Sprite

同时提供 `knowra-icons.sprite.svg`。如果某个页面不使用 React，可以把 sprite 内联进页面，再使用：

```html
<svg width="20" height="20" fill="none" stroke="currentColor">
  <use href="#knowra-folder"></use>
</svg>
```

## 预览

直接打开 `preview.html` 即可查看全部图标。

## 分组

- `files-knowledge.tsx`：笔记、书籍、题目、文件夹、标签、知识关系等
- `navigation.tsx`：搜索、新建、设置、面板、更多操作等
- `editor.tsx`：代码、列表、表格、排版、剪贴板等
- `states.tsx`：复选框、下拉、关闭、标签状态等
- `future.tsx`：Markdown/PDF、下载、导出、备份恢复、撤销重做等

## 设计约束

- 基准画布：24 × 24
- 默认线宽：1.75
- 线帽/连接：round
- 主色：`currentColor`
- 强调色：`var(--knowra-icon-accent, currentColor)`
- 不在图标组件中硬编码品牌色、间距或阴影
