// V4-04 ComponentShowcase
//
// 目的：
// 1. 让 V4-04 准出门禁的“所有适用状态完整”成为可执行检查。
// 2. 给视觉与交互验收提供单一可访问入口（1440 / 1280 / 1024 / 390）。
// 3. 给 Playwright 视觉基线提供稳定 target。

import { useState } from 'react';
import {
  Badge,
  Button,
  CANONICAL_COLOR_TOKENS,
  Checkbox,
  cx,
  Dialog,
  DialogBody,
  DialogClose,
  DialogFooter,
  DialogTrigger,
  EmptyState,
  IconButton,
  GridList,
  type GridListColumn,
  LoadingState,
  Menu,
  MenuItem,
  MenuPopover,
  MenuSeparator,
  MenuTrigger,
  Panel,
  Popover,
  PopoverTrigger,
  SearchBox,
  Select,
  StatusTone,
  Tabs,
  TagGroup,
  TextField,
  Tooltip,
  TooltipTrigger,
  Tree,
  type TreeItemData
} from '../index';
import {
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon
} from '../../icons/knowra';
import collectionStyles from '../collection/Collection.module.css';
import styles from './Showcase.module.css';

interface SampleRow {
  id: string;
  title: string;
  status: StatusTone;
  folder: string;
  updated: string;
  favorite: boolean;
}

const rows: SampleRow[] = [
  { id: 'n-001', title: 'V4-04 转译边界与状态契约', status: 'accent', folder: '/重构/V4', updated: '08-19 11:00', favorite: true },
  { id: 'n-002', title: '印格 demo 状态板（9 类）', status: 'success', folder: '/设计/印格', updated: '08-18 17:30', favorite: false },
  { id: 'n-003', title: 'Vite 工程隔离门禁脚本', status: 'warning', folder: '/重构/V4', updated: '08-16 18:22', favorite: false },
  { id: 'n-004', title: 'V4-03 共享 core 提取报告', status: 'success', folder: '/重构/V4', updated: '08-16 19:15', favorite: true },
  { id: 'n-005', title: 'V3 class 查询门禁修复', status: 'danger', folder: '/重构/V4', updated: '08-16 14:02', favorite: false }
];

const folderTree: TreeItemData[] = [
  {
    id: 'f-root',
    label: '工作区',
    children: [
      { id: 'f-1', label: '设计', count: 12, children: [
        { id: 'f-1-1', label: '印格' },
        { id: 'f-1-2', label: '方册' }
      ] },
      { id: 'f-2', label: '重构', count: 28, children: [
        { id: 'f-2-1', label: 'V4', count: 7 },
        { id: 'f-2-2', label: 'V3' }
      ] },
      { id: 'f-3', label: '回收站', isDisabled: true }
    ]
  }
];

const columns: GridListColumn<SampleRow>[] = [
  { id: 'title', template: 'minmax(220px, 2fr)', title: true, cell: (r) => r.title },
  { id: 'status', template: '0.6fr', cell: (r) => <Badge tone={r.status}>{labelForStatus(r.status)}</Badge> },
  { id: 'folder', template: '0.8fr', cell: (r) => r.folder },
  { id: 'updated', template: '0.6fr', cell: (r) => r.updated }
];

function labelForStatus(tone: StatusTone): string {
  switch (tone) {
    case 'accent': return '编辑中';
    case 'success': return '已完成';
    case 'warning': return '待整理';
    case 'danger': return '保存失败';
    default: return '未读';
  }
}

export function ComponentShowcase() {
  return (
    <main className={styles.showcase} aria-labelledby="v4-04-showcase-title">
      <header className={styles.hero}>
        <div>
          <h1 id="v4-04-showcase-title" className={styles.heroTitle}>Knowra V4 组件展台</h1>
          <p className={styles.heroSubtitle}>
            印格 V4-00.5 视觉冻结的 React + React Aria Components 转译结果。
            全部视觉签名（暖纸、墨线、点阵、零圆角、硬阴影）由 tokens.css 提供；本页为 V4-04 准出验收单一入口。
          </p>
        </div>
        <Badge tone="success">已冻结 V4-00.5</Badge>
      </header>

      <ColorTokens />
      <ButtonSection />
      <IconSection />
      <InputSection />
      <OverlaySection />
      <CollectionSection rows={rows} columns={columns} folderTree={folderTree} />
      <StatusSection />
    </main>
  );
}

function ColorTokens() {
  return (
    <section className={styles.section} aria-labelledby="section-tokens">
      <h2 id="section-tokens" className={styles.sectionTitle}>Canonical Tokens（颜色 1:1 转译）</h2>
      <div className={styles.colorList}>
        {CANONICAL_COLOR_TOKENS.map((name) => (
          <div key={name} className={styles.colorCard}>
            <div
              className={styles.colorSwatch}
              style={{ backgroundColor: `var(--${name})` }}
              aria-hidden="true"
            />
            <div className={styles.colorMeta}>
              <span className={styles.colorName}>--{name}</span>
              <span>var(--{name})</span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ButtonSection() {
  return (
    <section className={styles.section} aria-labelledby="section-buttons">
      <h2 id="section-buttons" className={styles.sectionTitle}>Button</h2>
      <p className={styles.sectionLead}>
        <strong>决策规则</strong>：① 危险 → <code>danger</code>；
        ② 当前容器最关键的那一个动作（保存/发布/确定/完成）→ <code>primary</code>（黑）；
        ③ 引导用户创建/引入/发现（新建/导入/添加/开始/搜索/邀请）→ <code>accent</code>（蓝）；
        ④ 次要/取消/关闭/返回 → <code>ghost</code>；⑤ 其它 → <code>default</code>。
        黑色与蓝色的边界：**层级 vs 语义**——一个容器最多 1 个 <code>primary</code>，<code>accent</code> 可重复。
      </p>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>4 个 variant 总览</span>
          <div className={styles.row}>
            <Button>默认</Button>
            <Button variant="primary">主操作</Button>
            <Button variant="danger">删除（红）</Button>
            <Button variant="ghost">取消（无底）</Button>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>
            同一上下文：primary（核心动作）+ accent（引导）+ ghost（弱化）共存
          </span>
          <div className={styles.stack}>
            <div className={styles.row}>
              <Button variant="primary">新建笔记</Button>
              <Button>导入 Markdown</Button>
              <Button variant="ghost">查看历史</Button>
            </div>
            <div className={styles.row}>
              <Button variant="primary">保存</Button>
              <Button variant="primary">发布</Button>
              <Button variant="ghost">放弃改动</Button>
            </div>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>形状：小型操作用胶囊，内容容器用小圆角矩形</span>
          <div className={styles.row}>
            <Button>默认胶囊</Button>
            <Button shape="square">小圆角矩形</Button>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>Disabled / Pending</span>
          <div className={styles.row}>
            <Button isDisabled>默认</Button>
            <Button variant="primary" isDisabled>保存</Button>
            <Button isPending>提交中</Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function IconSection() {
  return (
    <section className={styles.section} aria-labelledby="section-icons">
      <h2 id="section-icons" className={styles.sectionTitle}>IconButton（tone: ghost / floating / primary）</h2>
      <a className={styles.catalogLink} href="#/showcase/icons">浏览完整图标库 →</a>
      <p className={styles.sectionLead}>
        <strong>概念</strong>：纯图标无文字按钮（"ghost icon"），视觉与左轨 ModuleRail
        图标一致——30×30 透明方块，内部 SVG 20×20，hover 沉底加深、
        active translate(2px, 2px) 模拟按压、focus 接 --shadow-focus。
        与 Button 的 ghost variant 是<strong>两件事</strong>：后者是
        "弱化的有文字操作按钮"，本组件是"专门为纯图标操作入口"的薄封装。
        <br />
        <strong>适用</strong>：侧栏头部"更多 / 新建"、Tab 端点、工具条尾部、
        任何"只有图标、无文字"的次要操作入口。
      </p>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>3 个 size（24 / 30 / 40）</span>
          <div className={styles.row}>
            <IconButton size={24} aria-label="搜索（紧凑）">
              <SearchIcon size={14} />
            </IconButton>
            <IconButton size={30} aria-label="更多（侧栏头部默认）">
              <MoreHorizontalIcon size={20} />
            </IconButton>
            <IconButton size={40} aria-label="新建（与左轨 rail 一致）">
              <PlusIcon size={20} />
            </IconButton>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>状态：默认 / hover / focus / active / disabled</span>
          <div className={styles.row}>
            <IconButton aria-label="默认">
              <MoreHorizontalIcon size={20} />
            </IconButton>
            <IconButton aria-label="hover（鼠标停留时）" data-force-hover>
              <MoreHorizontalIcon size={20} />
            </IconButton>
            <IconButton aria-label="focus（键盘聚焦）" data-force-focus>
              <MoreHorizontalIcon size={20} />
            </IconButton>
            <IconButton aria-label="active（按压中）" data-force-active>
              <MoreHorizontalIcon size={20} />
            </IconButton>
            <IconButton aria-label="disabled（未上线）" disabled>
              <MoreHorizontalIcon size={20} />
            </IconButton>
          </div>
          <p style={{ fontSize: 11, color: 'var(--ink-secondary)', margin: 0 }}>
            hover / focus / active 用 data-* 属性强制展示（视觉演示用，非交互）。
          </p>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>floating 通透玻璃：默认 / 悬停 / 按下 / 禁用</span>
          <div className={styles.row}>
            <IconButton tone="floating" aria-label="玻璃新建"><PlusIcon size={16} /></IconButton>
            <IconButton tone="floating" aria-label="玻璃新建悬停" data-force-hover><PlusIcon size={16} /></IconButton>
            <IconButton tone="floating" aria-label="玻璃新建按下" data-force-active><PlusIcon size={16} /></IconButton>
            <IconButton tone="floating" aria-label="玻璃新建禁用" disabled><PlusIcon size={16} /></IconButton>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>primary 柔橙实心：默认 / 悬停 / 按下 / 禁用</span>
          <div className={styles.row}>
            <IconButton tone="primary" aria-label="柔橙新建"><PlusIcon size={16} /></IconButton>
            <IconButton tone="primary" aria-label="柔橙新建悬停" data-force-hover><PlusIcon size={16} /></IconButton>
            <IconButton tone="primary" aria-label="柔橙新建按下" data-force-active><PlusIcon size={16} /></IconButton>
            <IconButton tone="primary" aria-label="柔橙新建禁用" disabled><PlusIcon size={16} /></IconButton>
          </div>
        </div>

        <div className={styles.example}>
          <span className={styles.exampleLabel}>实际用法对照</span>
          <div className={styles.row}>
            <IconButton aria-label="新建笔记（笔记侧栏头部默认 size=30）">
              <PlusIcon size={20} />
            </IconButton>
            <IconButton size={40} aria-label="新建笔记（与左轨 rail 等大 size=40）">
              <PlusIcon size={20} />
            </IconButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function InputSection() {
  const [query, setQuery] = useState('');
  return (
    <section className={styles.section} aria-labelledby="section-inputs">
      <h2 id="section-inputs" className={styles.sectionTitle}>Input / SearchBox / Checkbox / Select</h2>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>TextField 默认 / 必填 / 错误</span>
          <div className={styles.stack}>
            <TextField label="标题" placeholder="请输入标题" />
            <TextField label="标签" description="回车可创建新标签" isRequired />
            <TextField label="路径" isInvalid errorMessage="路径已被占用" defaultValue="/重构/V4/重复" />
          </div>
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>SearchBox</span>
          <SearchBox
            label="搜索"
            size="field"
            placeholder="按标题、标签或正文"
            value={query}
            onChange={event => setQuery(event.target.value)}
            onClear={query ? () => setQuery('') : undefined}
            icon={
              <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <circle cx="6" cy="6" r="4" />
                <path d="M9 9l3 3" />
              </svg>
            }
          />
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Checkbox / Select</span>
          <div className={styles.stack}>
            <Checkbox defaultSelected>只看我编辑的资料</Checkbox>
            <Checkbox isIndeterminate>包含子目录</Checkbox>
            <Checkbox isDisabled>已归档</Checkbox>
            <Select
              label="排序方式"
              defaultSelectedKey="updated"
              options={[
                { id: 'updated', label: '按更新时间' },
                { id: 'created', label: '按创建时间' },
                { id: 'title', label: '按标题' }
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function OverlaySection() {
  return (
    <section className={styles.section} aria-labelledby="section-overlay">
      <h2 id="section-overlay" className={styles.sectionTitle}>Dialog / Menu / Popover / Tooltip / Tabs</h2>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Dialog（含焦点陷阱、Esc 关闭、inert 背景）</span>
          <div className={styles.row}>
            <DialogTrigger>
              <Button variant="primary" data-testid="trigger-new">新建资料</Button>
              <Dialog title="新建资料" description="所有字段必填。">
                <DialogBody>
                  <TextField label="标题" isRequired autoFocus />
                  <TextField label="位置" description="回车选择现有目录，或创建新目录" />
                  <TextField label="标签" placeholder="逗号分隔" />
                </DialogBody>
                <DialogFooter>
                  <DialogClose variant="ghost">取消</DialogClose>
                  <DialogClose variant="primary" isPending>保存</DialogClose>
                </DialogFooter>
              </Dialog>
            </DialogTrigger>
            <DialogTrigger>
              <Button variant="danger" data-testid="trigger-delete">删除</Button>
              <Dialog title="确认删除？" isDismissable>
                <DialogBody>
                  <p>此操作不可撤销。所有引用此资料的内容将变为孤立链接。</p>
                </DialogBody>
                <DialogFooter>
                  <DialogClose variant="ghost">取消</DialogClose>
                  <DialogClose variant="danger">确认删除</DialogClose>
                </DialogFooter>
              </Dialog>
            </DialogTrigger>
          </div>
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Menu / Popover</span>
          <div className={styles.row}>
            <MenuTrigger>
              <Button data-testid="trigger-more">更多</Button>
              <MenuPopover>
                <Menu ariaLabel="操作">
                  <MenuItem id="copy" kbd="⌘D">复制为 Markdown</MenuItem>
                  <MenuItem id="export" kbd="⌘E">导出</MenuItem>
                  <MenuSeparator />
                  <MenuItem id="trash" isDanger>移入回收站</MenuItem>
                </Menu>
              </MenuPopover>
            </MenuTrigger>
            <PopoverTrigger>
              <Button variant="ghost">详情</Button>
              <Popover>
                <div className={cx(collectionStyles.popover, collectionStyles.listbox)}>
                  <strong>印格</strong>
                  <p style={{ margin: 0, color: 'var(--ink-secondary)', fontSize: 12 }}>
                    暖纸 + 墨线 + 蓝色强调 + 硬阴影。
                  </p>
                </div>
              </Popover>
            </PopoverTrigger>
            <TooltipTrigger>
              <Button variant="ghost">悬停</Button>
              <Tooltip>用于解释次要操作；Esc 关闭。</Tooltip>
            </TooltipTrigger>
          </div>
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Tabs</span>
          <Tabs
            aria-label="视图切换"
            items={[
              { id: 'overview', label: '概览' },
              { id: 'activity', label: '活动', badge: 3 },
              { id: 'settings', label: '设置', isDisabled: true }
            ]}
          >
            {(item) => <Panel title={`${item.label} 视图`}>这是 {item.label} 的内容。</Panel>}
          </Tabs>
        </div>
      </div>
    </section>
  );
}

function CollectionSection({
  rows,
  columns,
  folderTree
}: {
  rows: SampleRow[];
  columns: GridListColumn<SampleRow>[];
  folderTree: TreeItemData[];
}) {
  return (
    <section className={styles.section} aria-labelledby="section-collections">
      <h2 id="section-collections" className={styles.sectionTitle}>Tree / GridList / TagGroup</h2>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Tree</span>
          <Tree items={folderTree} ariaLabel="目录" />
        </div>
        <div className={styles.example} style={{ gridColumn: 'span 2' }}>
          <span className={styles.exampleLabel}>GridList（资料行）</span>
          <GridList
            items={rows}
            columns={columns}
            getKey={(r) => r.id}
            ariaLabel="资料"
            selectionMode="multiple"
          />
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>TagGroup（tone / count / 选中 / 禁用 / 移除）</span>
          <div className={styles.stack}>
            <TagGroup
              label="Tone"
              visibleLabel
              trailing="5 个状态色"
              items={[
                { id: 'tn-1', label: '中性', tone: 'neutral' },
                { id: 'tn-2', label: '主色', tone: 'accent' },
                { id: 'tn-3', label: '成功', tone: 'success' },
                { id: 'tn-4', label: '警告', tone: 'warning' },
                { id: 'tn-5', label: '危险', tone: 'danger' }
              ]}
            />
            <TagGroup
              label="视图筛选"
              visibleLabel
              trailing={<span>单选</span>}
              selectionMode="single"
              defaultSelectedKeys={['v-recent']}
              items={[
                { id: 'v-recent', label: '最近', count: 12, tone: 'accent' },
                { id: 'v-todo', label: '待办', count: 5, tone: 'warning' },
                { id: 'v-archived', label: '归档', count: 0, tone: 'neutral' }
              ]}
            />
            <TagGroup
              label="已选标签（可移除）"
              visibleLabel
              trailing="3 / 4"
              onRemove={() => {
                // 演示用：真实场景中这里要更新受控状态并从 items 移除。
              }}
              items={[
                { id: 'tag-1', label: 'V4' },
                { id: 'tag-2', label: '印格', tone: 'accent' },
                { id: 'tag-3', label: '门禁', isDisabled: true },
                { id: 'tag-4', label: '草稿', tone: 'warning', hideDot: true }
              ]}
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusSection() {
  return (
    <section className={styles.section} aria-labelledby="section-status">
      <h2 id="section-status" className={styles.sectionTitle}>Badge / EmptyState / LoadingState / Panel</h2>
      <div className={styles.grid}>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Badge tone</span>
          <div className={styles.row}>
            <Badge tone="neutral">未读</Badge>
            <Badge tone="accent">编辑中</Badge>
            <Badge tone="success">已保存</Badge>
            <Badge tone="warning">待整理</Badge>
            <Badge tone="danger">保存失败</Badge>
          </div>
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>EmptyState</span>
          <EmptyState
            title="还没有匹配的资料"
            description="试试更换筛选条件，或新建第一份资料。"
            primaryAction={<Button variant="primary">新建资料</Button>}
            secondaryAction={<Button>导入 Markdown</Button>}
            escapeAction={<Button variant="ghost">重置筛选</Button>}
          />
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>LoadingState（骨架脉冲 / 方点）</span>
          <LoadingState label="正在加载资料…" />
          <LoadingState variant="dots" label="正在同步缓存…" />
        </div>
        <div className={styles.example}>
          <span className={styles.exampleLabel}>Panel（含 header / footer）</span>
          <Panel
            title="最近活动"
            headerActions={<Badge tone="accent">3</Badge>}
            footer={<span style={{ fontSize: 11, color: 'var(--ink-secondary)' }}>3 条新活动</span>}
          >
            <p style={{ margin: 0, fontSize: 12 }}>V4-04 转译边界已落地。</p>
            <p style={{ margin: 0, fontSize: 12 }}>V4-03 共享 core 已就绪。</p>
          </Panel>
        </div>
      </div>
    </section>
  );
}
