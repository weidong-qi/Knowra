import { useState, useSyncExternalStore } from 'react';
import { groupItemsByConcept } from '@study-accelerator/web-core';
import { useLocation, useNavigate } from '../../../app/router';
import { ChevronRightIcon, KnowledgeIcon } from '../../../components/icons/knowra';
import { SideNavItem, PressableButton } from '../../../components/ui';
import { useConceptState } from '../concepts/conceptStore';
import { useKnowledgeLibraryCache } from './KnowledgeLibraryProvider';
import {
  KNOWLEDGE_SCOPES,
  CONCEPT_SCOPES,
  knowledgeLibraryPath,
  parseKnowledgeLibraryRoute
} from './knowledgeLibraryRoute';
import styles from '../../notes/NotesContextSidebar.module.css';
export function KnowledgeContextSidebar() {
  const cache = useKnowledgeLibraryCache()!;
  const data = useSyncExternalStore(cache.subscribe, cache.getState);
  const concepts = useConceptState();
  const route = parseKnowledgeLibraryRoute(useLocation().pathname);
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const active = data.items.filter(item => !item.deletedAt);
  const ungrouped =
    groupItemsByConcept(
      concepts,
      active.filter(item => item.reviewStatus !== 'archived')
    ).find(group => !group.concept)?.items.length ?? 0;
  const itemCounts = Object.fromEntries(
    KNOWLEDGE_SCOPES.map(([scope]) => [
      scope,
      scope === 'trash'
        ? data.items.length - active.length
        : scope === 'ungrouped'
          ? ungrouped
          : active.filter(item =>
              scope === 'all' ? item.reviewStatus !== 'archived' : (item.reviewStatus ?? 'candidate') === scope
            ).length
    ])
  );
  const liveConcepts = concepts.concepts.filter(item => !item.deletedAt);
  const conceptCounts = Object.fromEntries(
    CONCEPT_SCOPES.map(([scope]) => [
      scope,
      liveConcepts.filter(item =>
        scope === 'archived'
          ? item.reviewStatus === 'archived'
          : item.reviewStatus !== 'archived' && (scope === 'all' || item.focus === scope)
      ).length
    ])
  );
  return (
    <div className={styles.sidebarContent}>
      <header className={styles.header}>
        <span className={styles.title}>知识库</span>
      </header>
      <nav className={styles.scrollBody} aria-label="知识库视图">
        {(
          [
            {
              page: 'items',
              title: '知识点',
              entries: KNOWLEDGE_SCOPES,
              counts: itemCounts,
              ready: data.status === 'ready'
            },
            {
              page: 'concepts',
              title: '概念',
              entries: CONCEPT_SCOPES,
              counts: conceptCounts,
              ready: concepts.status === 'ready'
            }
          ] as const
        ).map(section => (
          <section className={styles.section} key={section.page}>
            <div className={styles.sectionHeader}>
              <PressableButton
                className={styles.sectionToggle}
                aria-expanded={!collapsed.includes(section.page)}
                onPress={() =>
                  setCollapsed(rows =>
                    rows.includes(section.page) ? rows.filter(row => row !== section.page) : [...rows, section.page]
                  )
                }
              >
                <span className={styles.sectionChevron} data-expanded={!collapsed.includes(section.page) || undefined}>
                  <ChevronRightIcon size={12} />
                </span>
                <h2 className={styles.sectionTitle}>{section.title}</h2>
              </PressableButton>
            </div>
            {!collapsed.includes(section.page) ? (
              <div className={styles.sectionBody}>
                {section.entries.map(([scope, label]) => (
                  <SideNavItem
                    key={scope}
                    density="compact"
                    icon={<KnowledgeIcon size={16} />}
                    label={label}
                    count={
                      section.ready && (scope !== 'ungrouped' || concepts.status === 'ready')
                        ? section.counts[scope]
                        : undefined
                    }
                    aria-current={route.page === section.page && route.scope === scope ? 'page' : undefined}
                    onPress={() => navigate(knowledgeLibraryPath({ page: section.page, scope, query: '', id: null }))}
                  />
                ))}
              </div>
            ) : null}
          </section>
        ))}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>探索</h2>
          <SideNavItem
            density="compact"
            icon={<KnowledgeIcon size={16} />}
            label="概念图"
            aria-current={route.page === 'graph' ? 'page' : undefined}
            onPress={() => navigate('/knowledge/graph')}
          />
        </section>
        {data.error ? <p role="status">知识计数暂不可用，请在列表中重试加载。</p> : null}
      </nav>
    </div>
  );
}
