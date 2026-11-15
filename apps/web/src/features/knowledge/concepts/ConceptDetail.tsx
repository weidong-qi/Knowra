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
import { ConceptKnowledgeRow } from './ConceptKnowledgeRow';
import { knowledgeTypeLabel } from '../knowledgeViewModel';
import detailStyles from '../KnowledgeWorkspaceView.module.css';
import indexStyles from '../KnowledgeIndex.module.css';
import styles from './Concepts.module.css';
export function ConceptDetail({
  concept,
  items,
  links,
  definitions,
  write,
  pending,
  onEdit,
  onAttach,
  onWriteDefinition,
  onAction,
  onOpenItem,
  onRole,
  onRemove
}: {
  concept: KnowledgeConcept;
  items: Map<string, KnowledgeItem>;
  links: KnowledgeConceptLink[];
  definitions: KnowledgeItem[];
  write: boolean;
  pending: boolean;
  onEdit(): void;
  onAttach(): void;
  onWriteDefinition?: () => void;
  onAction(action: 'focus' | 'archive' | 'merge' | 'delete'): void;
  onOpenItem(id: string): void;
  onRole(link: KnowledgeConceptLink): void;
  onRemove(ids: string[], move: boolean): void;
}) {
  const [batch, setBatch] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<string[]>(['other-definitions']);
  const selection = selected.filter(id => links.some(link => link.id === id));
  const definitionIds = new Set(definitions.map(item => item.id));
  const groups = new Map<string, KnowledgeConceptLink[]>();
  for (const link of links) {
    if (definitionIds.has(link.knowledgeItemId)) continue;
    const type = items.get(link.knowledgeItemId)?.knowledgeType ?? 'concept';
    groups.set(type, [...(groups.get(type) ?? []), link]);
  }
  const renderLink = (link: KnowledgeConceptLink, definition = false) => (
    <ConceptKnowledgeRow
      key={link.id}
      item={items.get(link.knowledgeItemId)}
      link={link}
      definition={definition}
      batch={batch}
      selected={selection.includes(link.id)}
      write={write}
      pending={pending}
      onSelect={checked =>
        setSelected(current => (checked ? [...current, link.id] : current.filter(id => id !== link.id)))
      }
      onOpen={() => onOpenItem(link.knowledgeItemId)}
      onRole={() => onRole(link)}
      onRemove={move => onRemove([link.id], move)}
    />
  );
  const renderDefinition = (item: KnowledgeItem) =>
    renderLink(
      links.find(link => link.knowledgeItemId === item.id)!,
      true
    );
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
        {concept.sense && definitions.length ? <p className={detailStyles.prose}>{concept.sense}</p> : null}
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
      <section aria-label="定义" className={styles.definition}>
        <h3 className={styles.sectionHeading}>定义</h3>
        {definitions.length ? (
          <>
            <ul className={styles.list}>{renderDefinition(definitions[0]!)}</ul>
            {definitions.length > 1 ? (
              <>
                <PressableButton
                  className={indexStyles.groupHeading}
                  aria-expanded={!collapsed.includes('other-definitions')}
                  onPress={() =>
                    setCollapsed(current =>
                      current.includes('other-definitions')
                        ? current.filter(key => key !== 'other-definitions')
                        : [...current, 'other-definitions']
                    )
                  }
                >
                  <ChevronDownIcon size={13} />
                  <strong>其他定义</strong>
                  <span>{definitions.length - 1}</span>
                </PressableButton>
                {!collapsed.includes('other-definitions') ? (
                  <ul className={styles.list} aria-label="其他定义知识点">
                    {definitions.slice(1).map(renderDefinition)}
                  </ul>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <div className={styles.definitionEmpty}>
            <p>{concept.sense || '暂无定义。可以新写一条定义，或将已有的定义类知识点作为主体挂入。'}</p>
            {write && onWriteDefinition ? (
              <Button size="compact" isDisabled={pending} onPress={onWriteDefinition}>
                写定义
              </Button>
            ) : null}
          </div>
        )}
      </section>
      <h3 className={styles.sectionHeading}>关联知识点</h3>
      {groups.size ? (
        [...groups].map(([type, rows]) => (
          <section key={type} aria-label={`${knowledgeTypeLabel(type)}类知识点`}>
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
              <strong>{knowledgeTypeLabel(type)}类知识点</strong>
              <span>{rows.length}</span>
            </PressableButton>
            {!collapsed.includes(type) ? <ul className={styles.list}>{rows.map(link => renderLink(link))}</ul> : null}
          </section>
        ))
      ) : (
        <div className={indexStyles.empty}>
          <strong>{definitions.length ? '暂无其他关联知识点' : '这个概念下还没有知识点'}</strong>
          <p>
            {definitions.length
              ? '定义已显示在上方，也可以继续挂入其他知识点。'
              : '挂入已有知识点，并标明它讲述或提及这个概念。'}
          </p>
        </div>
      )}
    </article>
  );
}
