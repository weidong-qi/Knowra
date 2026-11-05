import { CalendarIcon, StatusRingIcon, TagIcon } from '../../components/icons/knowra';
import { Button } from '../../components/ui/button/Button';
import { SegmentedButton, SegmentedControl } from '../../components/ui/button/SegmentedControl';
import { Dialog, DialogBody, DialogClose, DialogFooter, DialogTrigger } from '../../components/ui/overlay/Dialog';
import { TextField } from '../../components/ui/input';
import { Menu, MenuItem, MenuPopover, MenuTrigger, SubmenuTrigger } from '../../components/ui/overlay/Menu';
import { BUTTON_STYLES, DEFAULT_BUTTON_STYLES, DIALOG_STYLES, setNotesIndexAppearance, useNotesIndexAppearance, type ButtonStyle, type DefaultButtonStyle, type DialogStyle } from '../notes/notesIndexAppearanceModel';
import { useCompactLayout } from '../../shell/useCompactLayout';
import styles from './SettingsView.module.css';

const BUTTON_STYLE_LABELS: Record<ButtonStyle, string> = { paper: '纸感', frost: '白玻璃' };
const DEFAULT_BUTTON_STYLE_LABELS: Record<DefaultButtonStyle, string> = { soft: '无边软影', glass: '乳白玻璃' };
const DIALOG_STYLE_LABELS: Record<DialogStyle, string> = { float: '浮起卡片', tray: '内嵌托盘' };

export function OverlayMaterialSettings() {
  const { overlayMaterial, buttonStyle, defaultButtonStyle, dialogStyle } = useNotesIndexAppearance();
  const compact = useCompactLayout();
  return <section className={styles.group} aria-labelledby="settings-appearance-heading">
    <h3 id="settings-appearance-heading">外观</h3>
    <div className={styles.settingList}>
      <div className={`${styles.settingRow} ${styles.materialRow}`}>
        <div className={styles.settingCopy}>
          <h4>浮层材质</h4>
          <p>通透玻璃轻盈透亮，磨砂亚克力柔和朦胧。应用于下拉菜单与弹出面板，切换后即时保存。</p>
        </div>
        <div className={`${styles.settingControl} ${styles.materialControl}`}>
          <SegmentedControl aria-label="浮层材质">
            <SegmentedButton aria-pressed={overlayMaterial === 'glass'} onPress={() => setNotesIndexAppearance({ overlayMaterial: 'glass' })}>通透玻璃</SegmentedButton>
            <SegmentedButton aria-pressed={overlayMaterial === 'acrylic'} onPress={() => setNotesIndexAppearance({ overlayMaterial: 'acrylic' })}>磨砂亚克力</SegmentedButton>
          </SegmentedControl>
          <MenuTrigger>
            <Button size="compact">预览菜单</Button>
            <MenuPopover>
              <Menu ariaLabel="材质预览">
                <SubmenuTrigger>
                  <MenuItem id="status" icon={<StatusRingIcon size={16} />}>状态</MenuItem>
                  <MenuPopover placement={compact ? 'bottom start' : 'right top'}>
                    <Menu ariaLabel="状态预览">
                      <MenuItem id="draft">草稿</MenuItem>
                      <MenuItem id="active">进行中</MenuItem>
                      <MenuItem id="done">已完成</MenuItem>
                    </Menu>
                  </MenuPopover>
                </SubmenuTrigger>
                <MenuItem id="tags" icon={<TagIcon size={16} />}>标签</MenuItem>
                <MenuItem id="updated" icon={<CalendarIcon size={16} />}>更新时间</MenuItem>
                <MenuItem id="disabled" isDisabled>不可用选项</MenuItem>
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
            {BUTTON_STYLES.map(style => <SegmentedButton key={style} aria-pressed={buttonStyle === style} onPress={() => setNotesIndexAppearance({ buttonStyle: style })}>{BUTTON_STYLE_LABELS[style]}</SegmentedButton>)}
          </SegmentedControl>
          <Button variant="primary" size="compact">主要按钮预览</Button>
        </div>
      </div>
      <div className={`${styles.settingRow} ${styles.materialRow}`}>
        <div className={styles.settingCopy}>
          <h4>默认按钮样式</h4>
          <p>影响白色的普通按钮（如「搜索」「日程」）。无边软影靠柔和投影托起，乳白玻璃半透明通透，切换后即时保存。</p>
        </div>
        <div className={`${styles.settingControl} ${styles.materialControl}`}>
          <SegmentedControl aria-label="默认按钮样式">
            {DEFAULT_BUTTON_STYLES.map(style => <SegmentedButton key={style} aria-pressed={defaultButtonStyle === style} onPress={() => setNotesIndexAppearance({ defaultButtonStyle: style })}>{DEFAULT_BUTTON_STYLE_LABELS[style]}</SegmentedButton>)}
          </SegmentedControl>
          <Button size="compact">默认按钮预览</Button>
        </div>
      </div>
      <div className={`${styles.settingRow} ${styles.materialRow}`}>
        <div className={styles.settingCopy}>
          <h4>对话框样式</h4>
          <p>影响「新建」「重命名」等对话框的外形。浮起卡片圆润柔和，内嵌托盘把按钮放在卡片外的托盘上，切换后即时保存。</p>
        </div>
        <div className={`${styles.settingControl} ${styles.materialControl}`}>
          <SegmentedControl aria-label="对话框样式">
            {DIALOG_STYLES.map(style => <SegmentedButton key={style} aria-pressed={dialogStyle === style} onPress={() => setNotesIndexAppearance({ dialogStyle: style })}>{DIALOG_STYLE_LABELS[style]}</SegmentedButton>)}
          </SegmentedControl>
          <DialogTrigger>
            <Button size="compact">预览对话框</Button>
            <Dialog title="新建文件夹" description="这是对话框样式预览，不会创建任何内容。">
              <DialogBody><TextField label="文件夹名称" isRequired /></DialogBody>
              <DialogFooter><DialogClose variant="ghost">取消</DialogClose><DialogClose variant="primary">创建</DialogClose></DialogFooter>
            </Dialog>
          </DialogTrigger>
        </div>
      </div>
    </div>
  </section>;
}
