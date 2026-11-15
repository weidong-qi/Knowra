import type { KnowledgeConceptLink, KnowledgeItem } from '@study-accelerator/web-core';
import {
  Checkbox,
  IconButton,
  Menu,
  MenuItem,
  MenuPopover,
  MenuTrigger,
  PressableButton
} from '../../../components/ui';
import { MoreHorizontalIcon } from '../../../components/icons/knowra';
import { MathText } from '../../../components/math/MathText';
import { knowledgeStatusLabel } from '../knowledgeViewModel';
import styles from './Concepts.module.css';

/** 定义与普通挂靠共用角色、选择和行操作，定义不会再重复出现在普通分组。 */
export function ConceptKnowledgeRow({
  item,
  link,
  definition = false,
  batch,
  selected,
  write,
  pending,
  onSelect,
  onOpen,
  onRole,
  onRemove
}: {
  item?: KnowledgeItem;
  link: KnowledgeConceptLink;
  definition?: boolean;
  batch: boolean;
  selected: boolean;
  write: boolean;
  pending: boolean;
  onSelect(checked: boolean): void;
  onOpen(): void;
  onRole(): void;
  onRemove(move: boolean): void;
}) {
  const title = item?.title || '未命名知识';
  return (
    <li className={styles.linkRow} data-definition={definition || undefined} data-batch={(batch && write) || undefined}>
      {batch && write ? <Checkbox aria-label={`选择${title}`} isSelected={selected} onChange={onSelect} /> : null}
      <PressableButton
        className={`${styles.linkTitle} ${definition ? styles.definitionText : ''}`}
        aria-label={definition ? `查看定义知识：${title}` : undefined}
        onPress={onOpen}
      >
        <MathText
          text={definition ? item?.canonicalStatement || '尚未填写定义正文，点击补充。' : title}
          inlineOnly={!definition}
        />
      </PressableButton>
      {definition && item ? (
        <span className={styles.definitionStatus}>{knowledgeStatusLabel(item.reviewStatus)}</span>
      ) : null}
      <span className={styles.role} data-role={link.role}>
        {link.role === 'subject' ? '主体' : '提及'}
      </span>
      {write ? (
        <MenuTrigger>
          <IconButton size={28} aria-label={`挂靠操作：${title}`} isDisabled={pending}>
            <MoreHorizontalIcon size={15} />
          </IconButton>
          <MenuPopover>
            <Menu
              ariaLabel="挂靠操作"
              onAction={key => {
                if (key === 'role') onRole();
                else onRemove(key === 'move');
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
}
