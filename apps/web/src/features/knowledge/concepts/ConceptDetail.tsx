import { useState } from 'react';
import type { KnowledgeConcept, KnowledgeConceptLink, KnowledgeItem } from '@study-accelerator/web-core';
import {
  Button,
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  PressableButton
} from '../../../components/ui';
import { ChevronDownIcon, MoreHorizontalIcon } from '../../../components/icons/knowra';
import { MathText } from '../../../components/math/MathText';
import { knowledgeTypeLabel } from '../knowledgeViewModel';
import detailStyles from '../KnowledgeWorkspaceView.module.css';
import indexStyles from '../KnowledgeIndex.module.css';
import styles from './Concepts.module.css';
export function ConceptDetail({
  concept,
  items,
  links,
  write,
  pending,
  onEdit,
  onAttach,
  onAction,
  onOpenItem,
  onRole,
  onRemove
}: {
  concept: KnowledgeConcept;
  items: Map<string, KnowledgeItem>;
  links: KnowledgeConceptLink[];
  write: boolean;
  pending: boolean;
  onEdit(): void;
  onAttach(): void;
  onAction(action: 'focus' | 'archive' | 'merge' | 'delete'): void;
  onOpenItem(id: string): void;
  onRole(link: KnowledgeConceptLink): void;
  onRemove(ids: string[], move: boolean): void;
}) {
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const selection = selected.filter(id => links.some(link => link.id === id));
  const groups = new Map<string, KnowledgeConceptLink[]>();
  for (const link of links) {
    const type = items.get(link.knowledgeItemId)?.knowledgeType ?? 'concept';
    groups.set(type, [...(groups.get(type) ?? []), link]);
  }
  return (
    <article aria-label="概念详情" className={detailStyles.detail}>
      <header className={detailStyles.detailHeader}>
        <div className={detailStyles.meta}>
          <span className={detailStyles.badge}>
            {concept.reviewStatus === 'archived' ? '已归档' : concept.focus === 'active' ? '关注' : '不关注'}
          </span>
          <span>
            主体 {links.filter(link => link.role === 'subject').length} · 提及{' '}
            {links.filter(link => link.role === 'mentions').length}
          </span>
        </div>
        <h2>{concept.name}</h2>
        {concept.sense ? <p className={detailStyles.prose}>{concept.sense}</p> : null}
        <p className={detailStyles.hint}>别名：{concept.aliases.join('、') || '暂无'}</p>
        {write ? (
          <div className={detailStyles.actions}>
            <Button isDisabled={pending} onPress={onEdit}>
              编辑概念
            </Button>
            <Button variant="primary" isDisabled={pending} onPress={onAttach}>
              挂入知识点
            </Button>
            <MenuTrigger>
              <IconButton aria-label="概念更多操作" isDisabled={pending}>
                <MoreHorizontalIcon size={16} />
              </IconButton>
              <MenuPopover>
                <Menu
                  ariaLabel="概念操作"
                  onAction={key => {
                    if (key === 'batch') {
                      setBatch(value => !value);
                      setSelected([]);
                    } else onAction(key as 'focus' | 'archive' | 'merge' | 'delete');
                  }}
                >
                  <MenuItem id="focus">{concept.focus === 'active' ? '不再关注' : '关注概念'}</MenuItem>
                  <MenuItem id="archive">{concept.reviewStatus === 'archived' ? '恢复概念' : '归档概念'}</MenuItem>
                  <MenuItem id="batch">{batch ? '退出批量管理' : '批量管理'}</MenuItem>
                  <MenuItem id="merge">合并到…</MenuItem>
                  <MenuItem id="delete" isDanger>
                    删除概念
                  </MenuItem>
                </Menu>
              </MenuPopover>
            </MenuTrigger>
          </div>
        ) : null}
      </header>
      {batch && write ? (
        <div className={styles.batchBar} aria-label="批量挂靠管理">
          <Checkbox
            isSelected={Boolean(links.length) && selection.length === links.length}
            onChange={checked => setSelected(checked ? links.map(link => link.id) : [])}
          >
            全选
          </Checkbox>
          <span>已选 {selection.length} 条</span>
          <Button size="compact" isDisabled={!selection.length || pending} onPress={() => onRemove(selection, true)}>
            移到其他概念
          </Button>
          <Button
            size="compact"
            variant="danger"
            isDisabled={!selection.length || pending}
            onPress={() => onRemove(selection, false)}
          >
            移出
          </Button>
          <Button
            size="compact"
            variant="ghost"
            onPress={() => {
              setBatch(false);
              setSelected([]);
            }}
          >
            完成
          </Button>
        </div>
      ) : null}
      {groups.size ? (
        [...groups].map(([type, rows]) => (
          <section key={type} aria-label={knowledgeTypeLabel(type)}>
            <PressableButton
              className={indexStyles.groupHeading}
              aria-expanded={!collapsed.includes(type)}
              onPress={() =>
                setCollapsed(current =>
                  current.includes(type) ? current.filter(row => row !== type) : [...current, type]
                )
              }
            >
              <ChevronDownIcon size={13} />
              <strong>{knowledgeTypeLabel(type)}</strong>
              <span>{rows.length}</span>
            </PressableButton>
            {!collapsed.includes(type) ? (
              <ul className={styles.list}>
                {rows.map(link => {
                  const item = items.get(link.knowledgeItemId);
                  return (
                    <li key={link.id} className={styles.linkRow}>
                      {batch && write ? (
                        <Checkbox
                          aria-label={`选择${item?.title}`}
                          isSelected={selection.includes(link.id)}
                          onChange={checked =>
                            setSelected(current =>
                              checked ? [...current, link.id] : current.filter(row => row !== link.id)
                            )
                          }
                        />
                      ) : null}
                      <PressableButton className={styles.linkTitle} onPress={() => onOpenItem(link.knowledgeItemId)}>
                        <MathText text={item?.title || '未命名知识'} inlineOnly />
                      </PressableButton>
                      <span className={styles.role} data-role={link.role}>
                        {link.role === 'subject' ? '主体' : '提及'}
                      </span>
                      {write ? (
                        <MenuTrigger>
                          <IconButton size={28} aria-label={`挂靠操作：${item?.title}`} isDisabled={pending}>
                            <MoreHorizontalIcon size={15} />
                          </IconButton>
                          <MenuPopover>
                            <Menu
                              ariaLabel="挂靠操作"
                              onAction={key => {
                                if (key === 'role') onRole(link);
                                else onRemove([link.id], key === 'move');
                              }}
                            >
                              <MenuItem id="role">{link.role === 'subject' ? '改为提及' : '改为主体'}</MenuItem>
                              <MenuItem id="move">移动</MenuItem>
                              <MenuItem id="remove" isDanger>
                                移出
                              </MenuItem>
                            </Menu>
                          </MenuPopover>
                        </MenuTrigger>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </section>
        ))
      ) : (
        <div className={indexStyles.empty}>
          <strong>这个概念下还没有知识点</strong>
          <p>挂入已有知识点，并标明它讲述或提及这个概念。</p>
          {write ? <Button onPress={onAttach}>挂入知识点</Button> : null}
        </div>
      )}
    </article>
  );
}
