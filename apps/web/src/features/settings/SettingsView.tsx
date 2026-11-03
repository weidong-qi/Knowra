import { useRef, useState } from 'react';
import { SideNavItem } from '../../components/ui';
import { SegmentedButton, SegmentedControl } from '../../components/ui/button/SegmentedControl';
import { Checkbox } from '../../components/ui/input/Checkbox';
import {
  WorkspacePanel,
  WorkspacePanelBody,
  WorkspacePanelFooter,
  WorkspacePanelHeader
} from '../../components/workspace/WorkspacePanel';
import { PathTrail } from '../../shell/PathTrail';
import { SettingsIcon } from '../../components/icons/knowra';
import type { AppPreferences, NoteFontSize } from './preferences';
import { ModelConnectionSettings } from './ModelConnectionSettings';
import { UsageSettings } from './UsageSettings';
import { BudgetLimitsSettings } from './BudgetLimitsSettings';
import { AiFeatureSettings } from './AiFeatureSettings';
import { ExternalClientSettings } from './ExternalClientSettings';
import { isDesktopRuntime } from './externalClients';
import { BuildInformation } from './BuildInformation';
import { OverlayMaterialSettings } from './OverlayMaterialSettings';
import { AnnotationInlineMigrationDialog } from './AnnotationInlineMigrationDialog';
import { Button } from '../../components/ui/button';
import styles from './SettingsView.module.css';

interface SettingsViewProps {
  preferences: AppPreferences;
  sidebarOpen: boolean;
  onPreferencesChange(preferences: AppPreferences): void;
  onSidebarOpenChange(open: boolean): void;
}

type SettingsCategory = 'all' | 'workspace' | 'appearance' | 'reading' | 'accessibility' | 'model' | 'about';

/** “外部 AI 客户端”与“迁移重点到正文”只在 Mac 应用的本地运行端出现，计数随之增加。 */
const buildCategories = (extra: number): { id: SettingsCategory; label: string; count: number }[] => [
  { id: 'all', label: '全部设置', count: 9 + extra * 2 },
  { id: 'workspace', label: '工作区', count: 1 + extra },
  { id: 'appearance', label: '外观', count: 1 },
  { id: 'reading', label: '阅读与编辑', count: 1 },
  { id: 'accessibility', label: '辅助体验', count: 1 },
  { id: 'model', label: '模型接入', count: 4 + extra },
  { id: 'about', label: '关于知境', count: 1 }
];

const fontSizes: { value: NoteFontSize; label: string }[] = [
  { value: 15, label: '小' },
  { value: 17, label: '标准' },
  { value: 19, label: '大' }
];

export function SettingsView({ preferences, sidebarOpen, onPreferencesChange, onSidebarOpenChange }: SettingsViewProps) {
  const [category, setCategory] = useState<SettingsCategory>('all');
  const [migrationOpen, setMigrationOpen] = useState(false);
  const detailsRef = useRef<HTMLDivElement>(null);
  const categories = buildCategories(isDesktopRuntime() ? 1 : 0);
  const selectedCategory = categories.find((item) => item.id === category) ?? categories[0];

  function selectCategory(next: SettingsCategory) {
    setCategory(next);
    if (detailsRef.current) detailsRef.current.scrollTop = 0;
  }

  return <WorkspacePanel as="main" aria-labelledby="settings-title">
    {migrationOpen ? <AnnotationInlineMigrationDialog isOpen={migrationOpen} onOpenChange={setMigrationOpen} /> : null}
    <WorkspacePanelHeader
      title="设置"
      code="PREF"
      titleId="settings-title"
      icon={<SettingsIcon size={14} />}
      breadcrumb={<PathTrail path={[{ id: 'settings', label: '设置', current: true }]} variant="top" />}
      actionsLabel="设置范围"
      actions={<span className={styles.scope}>当前运行端</span>}
    />
    <WorkspacePanelBody grid className={styles.body} aria-label="设置内容">
      <nav className={styles.categoryNav} aria-label="设置分类">
        {categories.map((item) => <SideNavItem
          key={item.id}
          className={styles.categoryButton}
          label={item.label}
          count={item.count}
          aria-pressed={category === item.id}
          onPress={() => selectCategory(item.id)}
        />)}
      </nav>

      <div ref={detailsRef} className={styles.details} aria-label="具体设置">
        {category === 'all' || category === 'workspace' ? <section className={styles.group} aria-labelledby="settings-workspace-heading">
          <h3 id="settings-workspace-heading">工作区</h3>
          <div className={styles.settingList}>
            <div className={styles.settingRow}>
              <div className={styles.settingCopy}>
                <h4>显示笔记目录栏</h4>
                <p>在笔记索引和编辑页面显示左侧目录；也可以随时用底部状态栏切换。</p>
              </div>
              <div className={styles.settingControl}>
                <span>{sidebarOpen ? '已显示' : '已隐藏'}</span>
                <Checkbox className={styles.settingCheckbox} isSelected={sidebarOpen} onChange={onSidebarOpenChange} aria-label="显示笔记目录栏" />
              </div>
            </div>
            {isDesktopRuntime() ? <div className={styles.settingRow}>
              <div className={styles.settingCopy}>
                <h4>迁移重点到正文</h4>
                <p>把旧版重点写进笔记正文。会先检查并列出影响，确认后自动备份再迁移；只需执行一次。</p>
              </div>
              <div className={styles.settingControl}>
                <Button onPress={() => setMigrationOpen(true)}>检查并迁移…</Button>
              </div>
            </div> : null}
          </div>
        </section> : null}

        {category === 'all' || category === 'appearance' ? <OverlayMaterialSettings /> : null}

        {category === 'all' || category === 'reading' ? <section className={styles.group} aria-labelledby="settings-reading-heading">
          <h3 id="settings-reading-heading">阅读与编辑</h3>
          <div className={styles.settingList}>
            <div className={styles.settingRow}>
              <div className={styles.settingCopy}>
                <h4>笔记正文字号</h4>
                <p>只调整笔记正文；工具栏与其他界面文字保持原有大小。</p>
              </div>
              <div className={styles.settingControl}>
                <span>{preferences.noteFontSize} 像素</span>
                <SegmentedControl aria-label="笔记正文字号">
                  {fontSizes.map(({ value, label }) => <SegmentedButton
                    key={value}
                    aria-label={`${label}（${value} 像素）`}
                    aria-pressed={preferences.noteFontSize === value}
                    onPress={() => onPreferencesChange({ ...preferences, noteFontSize: value })}
                  >{label}</SegmentedButton>)}
                </SegmentedControl>
              </div>
            </div>
          </div>
        </section> : null}

        {category === 'all' || category === 'accessibility' ? <section className={styles.group} aria-labelledby="settings-accessibility-heading">
          <h3 id="settings-accessibility-heading">辅助体验</h3>
          <div className={styles.settingList}>
            <div className={styles.settingRow}>
              <div className={styles.settingCopy}>
                <h4>减少界面动效</h4>
                <p>关闭界面过渡与动画；系统的“减少动态效果”设置也会自动生效。</p>
              </div>
              <div className={styles.settingControl}>
                <span>{preferences.reduceMotion ? '已开启' : '未开启'}</span>
                <Checkbox
                  className={styles.settingCheckbox}
                  isSelected={preferences.reduceMotion}
                  onChange={(reduceMotion) => onPreferencesChange({ ...preferences, reduceMotion })}
                  aria-label="减少界面动效"
                />
              </div>
            </div>
          </div>
        </section> : null}

        {category === 'all' || category === 'model' ? <ModelConnectionSettings /> : null}
        {category === 'all' || category === 'model' ? <UsageSettings /> : null}
        {category === 'all' || category === 'model' ? <BudgetLimitsSettings /> : null}
        {category === 'all' || category === 'model' ? <AiFeatureSettings /> : null}
        {category === 'all' || category === 'model' ? <ExternalClientSettings /> : null}
        {category === 'all' || category === 'about' ? <BuildInformation /> : null}
      </div>
    </WorkspacePanelBody>
    <WorkspacePanelFooter>
      <span>显示 {selectedCategory.count} / {categories[0].count} 项设置</span>
      <span>个人偏好即时保存 · 模型配置手动保存</span>
    </WorkspacePanelFooter>
  </WorkspacePanel>;
}
