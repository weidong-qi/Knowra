import { buildInfo, type BuildInfo } from '../../app/buildInfo';
import styles from './SettingsView.module.css';

const states = { clean: '已提交（clean）', dirty: '含未提交修改（dirty）', unknown: '无法确认（unknown）' };
const sources = { git: 'Git 工作树', external: '构建环境显式提供', unknown: '未提供' };

export function BuildInformation({ info = buildInfo }: { info?: BuildInfo }) {
  return <section className={styles.group} aria-labelledby="settings-build-heading">
    <h3 id="settings-build-heading">关于知境·Knowra</h3>
    <dl className={styles.buildInformation}>
      <div><dt>应用版本</dt><dd>{info.version}</dd></div>
      <div><dt>完整提交 SHA</dt><dd><code>{info.commit || '未知'}</code></dd></div>
      <div><dt>构建状态</dt><dd>{states[info.state]}</dd></div>
      <div><dt>标识来源</dt><dd>{sources[info.source]}</dd></div>
      <div><dt>构建时间（UTC）</dt><dd>{info.builtAt || '未知'}</dd></div>
    </dl>
  </section>;
}
