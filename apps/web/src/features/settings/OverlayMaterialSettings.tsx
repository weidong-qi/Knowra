import { useEffect, useState } from 'react';
import { CalendarIcon, StatusRingIcon, TagIcon } from '../../components/icons/knowra';
import { Button } from '../../components/ui/button/Button';
import { SegmentedButton, SegmentedControl } from '../../components/ui/button/SegmentedControl';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogTrigger } from '../../components/ui/overlay/Dialog';
import { ColorPicker, Switch, TextField } from '../../components/ui/input';
import { Menu, MenuItem, MenuPopover, MenuTrigger, SubmenuTrigger } from '../../components/ui/overlay/Menu';
import {
  ACCENT_COLORS,
  BUTTON_STYLES,
  DIALOG_STYLES,
  DOCUMENT_ICON_STYLES,
  setNotesIndexAppearance,
  useNotesIndexAppearance,
  type AccentColor,
  type ButtonStyle,
  type DocumentIconStyle,
  type DialogStyle
} from '../notes/notesIndexAppearanceModel';
import { useCompactLayout } from '../../shell/useCompactLayout';
import styles from './SettingsView.module.css';

const ACCENT_COLOR_LABELS: Record<AccentColor, string> = { ink: '墨黑', orange: '暖橙' };
const DOCUMENT_ICON_STYLE_LABELS: Record<DocumentIconStyle, string> = { capsule: '胶囊徽标', layout: '学术版式' };
const BUTTON_STYLE_LABELS: Record<ButtonStyle, string> = { paper: '纸感', frost: '白玻璃' };
const DIALOG_STYLE_LABELS: Record<DialogStyle, string> = { float: '浮起卡片', tray: '内嵌托盘' };

function ShellColorSetting({
  title,
  value,
  fallback,
  onChange
}: {
  title: string;
  value: string | null;
  fallback: string;
  onChange(value: string | null): void;
}) {
  const [draft, setDraft] = useState(value ?? fallback);
  useEffect(() => setDraft(value ?? fallback), [value, fallback]);
  return (
    <div className={`${styles.settingRow} ${styles.materialRow}`}>
      <div className={styles.settingCopy}>
        <h4>{title}</h4>
        <p>单独设置当前浅色或深色模式的背景，输入有效颜色后即时保存。</p>
      </div>
      <div className={`${styles.settingControl} ${styles.materialControl}`}>
        <ColorPicker
          value={draft}
          presets={[]}
          onChange={next => {
            setDraft(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next);
          }}
        />
        <Button
          size="compact"
          onPress={() => {
            setDraft(fallback);
            onChange(null);
          }}
        >
          恢复默认
        </Button>
      </div>
    </div>
  );
}

export function OverlayMaterialSettings() {
  const appearance = useNotesIndexAppearance();
  const { mode, overlayMaterial, buttonStyle, dialogStyle, accentColor, documentIconStyle } = appearance;
  const shellColorKey = mode === 'dark' ? 'shellColorDark' : 'shellColorLight';
  const sidebarColorKey = mode === 'dark' ? 'sidebarColorDark' : 'sidebarColorLight';
  const compact = useCompactLayout();
  return (
    <section className={styles.group} aria-labelledby="settings-appearance-heading">
      <h3 id="settings-appearance-heading">外观</h3>
      <div className={styles.settingList}>
        <ShellColorSetting
          key={`shell-${mode}`}
          title="外栏背景"
          value={appearance[shellColorKey]}
          fallback={mode === 'dark' ? '#101114' : '#f1f2f5'}
          onChange={value => setNotesIndexAppearance({ [shellColorKey]: value })}
        />
        <ShellColorSetting
          key={`sidebar-${mode}`}
          title="上下文侧栏背景"
          value={appearance[sidebarColorKey]}
          fallback={mode === 'dark' ? '#1e2025' : '#fafafb'}
          onChange={value => setNotesIndexAppearance({ [sidebarColorKey]: value })}
        />
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>上下文侧栏外形</h4>
            <p>独立调整侧栏与内容区的间距、圆角和细边线；窄屏仍使用弹层。</p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <Switch
              isSelected={appearance.sidebarCard}
              onChange={sidebarCard => setNotesIndexAppearance({ sidebarCard })}
            >
              独立间距
            </Switch>
            <Switch
              isSelected={appearance.sidebarRounded}
              onChange={sidebarRounded => setNotesIndexAppearance({ sidebarRounded })}
            >
              四角圆角
            </Switch>
            <Switch
              isSelected={appearance.sidebarBorder}
              onChange={sidebarBorder => setNotesIndexAppearance({ sidebarBorder })}
            >
              细边线
            </Switch>
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>文档图标风格</h4>
            <p>切换笔记和 PDF 在图标视图中的风格，卡片封面保持原样。切换后即时保存。</p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <SegmentedControl aria-label="文档图标风格">
              {DOCUMENT_ICON_STYLES.map(style => (
                <SegmentedButton
                  key={style}
                  aria-pressed={documentIconStyle === style}
                  onPress={() => setNotesIndexAppearance({ documentIconStyle: style })}
                >
                  {DOCUMENT_ICON_STYLE_LABELS[style]}
                </SegmentedButton>
              ))}
            </SegmentedControl>
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>强调色</h4>
            <p>切换全局强调色，浅色与深色模式自动适配，切换后即时保存。</p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <SegmentedControl aria-label="强调色">
              {ACCENT_COLORS.map(color => (
                <SegmentedButton
                  key={color}
                  aria-pressed={accentColor === color}
                  onPress={() => setNotesIndexAppearance({ accentColor: color })}
                >
                  {ACCENT_COLOR_LABELS[color]}
                </SegmentedButton>
              ))}
            </SegmentedControl>
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>浮层材质</h4>
            <p>通透玻璃轻盈透亮，磨砂亚克力柔和朦胧。应用于下拉菜单与弹出面板，切换后即时保存。</p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <SegmentedControl aria-label="浮层材质">
              <SegmentedButton
                aria-pressed={overlayMaterial === 'glass'}
                onPress={() => setNotesIndexAppearance({ overlayMaterial: 'glass' })}
              >
                通透玻璃
              </SegmentedButton>
              <SegmentedButton
                aria-pressed={overlayMaterial === 'acrylic'}
                onPress={() => setNotesIndexAppearance({ overlayMaterial: 'acrylic' })}
              >
                磨砂亚克力
              </SegmentedButton>
            </SegmentedControl>
            <MenuTrigger>
              <Button size="compact">预览菜单</Button>
              <MenuPopover>
                <Menu ariaLabel="材质预览">
                  <SubmenuTrigger>
                    <MenuItem id="status" icon={<StatusRingIcon size={16} />}>
                      状态
                    </MenuItem>
                    <MenuPopover placement={compact ? 'bottom start' : 'right top'}>
                      <Menu ariaLabel="状态预览">
                        <MenuItem id="draft">草稿</MenuItem>
                        <MenuItem id="active">进行中</MenuItem>
                        <MenuItem id="done">已完成</MenuItem>
                      </Menu>
                    </MenuPopover>
                  </SubmenuTrigger>
                  <MenuItem id="tags" icon={<TagIcon size={16} />}>
                    标签
                  </MenuItem>
                  <MenuItem id="updated" icon={<CalendarIcon size={16} />}>
                    更新时间
                  </MenuItem>
                  <MenuItem id="disabled" isDisabled>
                    不可用选项
                  </MenuItem>
                </Menu>
              </MenuPopover>
            </MenuTrigger>
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>按钮样式</h4>
            <p>影响各处的主要操作按钮（如「创建」「保存」）。纸感简洁，白玻璃轻盈通透，切换后即时保存。</p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <SegmentedControl aria-label="按钮样式">
              {BUTTON_STYLES.map(style => (
                <SegmentedButton
                  key={style}
                  aria-pressed={buttonStyle === style}
                  onPress={() => setNotesIndexAppearance({ buttonStyle: style })}
                >
                  {BUTTON_STYLE_LABELS[style]}
                </SegmentedButton>
              ))}
            </SegmentedControl>
            <Button variant="primary" size="compact">
              主要按钮预览
            </Button>
          </div>
        </div>
        <div className={`${styles.settingRow} ${styles.materialRow}`}>
          <div className={styles.settingCopy}>
            <h4>对话框样式</h4>
            <p>
              影响「新建」「重命名」等对话框的外形。浮起卡片圆润柔和，内嵌托盘把按钮放在卡片外的托盘上，切换后即时保存。
            </p>
          </div>
          <div className={`${styles.settingControl} ${styles.materialControl}`}>
            <SegmentedControl aria-label="对话框样式">
              {DIALOG_STYLES.map(style => (
                <SegmentedButton
                  key={style}
                  aria-pressed={dialogStyle === style}
                  onPress={() => setNotesIndexAppearance({ dialogStyle: style })}
                >
                  {DIALOG_STYLE_LABELS[style]}
                </SegmentedButton>
              ))}
            </SegmentedControl>
            <DialogTrigger>
              <Button size="compact">预览对话框</Button>
              <Dialog title="新建文件夹" description="这是对话框样式预览，不会创建任何内容。">
                <DialogBody>
                  <TextField label="文件夹名称" isRequired />
                </DialogBody>
                <DialogFooter>
                  <DialogClose variant="ghost">取消</DialogClose>
                  <DialogClose variant="primary">创建</DialogClose>
                </DialogFooter>
              </Dialog>
            </DialogTrigger>
          </div>
        </div>
      </div>
    </section>
  );
}
