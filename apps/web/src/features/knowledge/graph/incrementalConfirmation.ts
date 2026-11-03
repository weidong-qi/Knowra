/** 独立实验合同：不是正式 KnowledgeItem，也不接收 result.json 的已应用 state。 */
export interface DemoConcept { readonly id: string; readonly name: string; readonly sense: string }
export interface DemoItem { readonly id: string; readonly title: string; readonly statement: string; readonly conceptIds: readonly string[]; readonly source?: { readonly note: string; readonly quote: string } }
export interface DemoProposal {
  readonly id: string; readonly title: string; readonly statement: string;
  readonly source: { readonly note: string; readonly quote: string };
  readonly candidateId: string; readonly suggestedName: string; readonly suggestedSense: string;
  readonly opinion?: string;
}
export interface ConfirmationFixture {
  readonly concepts: readonly DemoConcept[];
  readonly items: readonly DemoItem[];
  readonly proposals: readonly DemoProposal[];
}
export type DemoDecision = { kind: 'existing'; conceptId: string } | { kind: 'new'; name: string; sense: string } | { kind: 'defer' };
export type DemoSession = Readonly<Record<string, DemoDecision>>;
export const DEMO_NAME_LIMIT = 80;
export const DEMO_SENSE_LIMIT = 240;

/** 同一条只能决定一次；修改需要先撤销，重复点击不会追加资产。 */
export function decide(fixture: ConfirmationFixture, session: DemoSession, proposalId: string, decision: DemoDecision): DemoSession {
  const proposal = fixture.proposals.find(row => row.id === proposalId);
  if (!proposal || session[proposalId]) return session;
  if (decision.kind === 'existing' && (decision.conceptId !== proposal.candidateId || !fixture.concepts.some(row => row.id === decision.conceptId))) return session;
  if (decision.kind === 'new') {
    const name = decision.name.trim(); const sense = decision.sense.trim();
    if (!name || !sense || name.length > DEMO_NAME_LIMIT || sense.length > DEMO_SENSE_LIMIT) return session;
    return { ...session, [proposalId]: { kind: 'new', name, sense } };
  }
  return { ...session, [proposalId]: decision };
}
export function undoDecision(session: DemoSession, proposalId: string): DemoSession {
  const next = { ...session }; delete next[proposalId]; return next;
}

/** 只派生本次新增内容。旧对象不被修改；待定不会产生概念或挂靠。 */
export function projectSession(fixture: ConfirmationFixture, session: DemoSession) {
  const concepts: DemoConcept[] = []; const items: DemoItem[] = [];
  for (const proposal of fixture.proposals) {
    const decision = session[proposal.id];
    if (!decision || decision.kind === 'defer') continue;
    const conceptId = decision.kind === 'existing' ? decision.conceptId : `demo-concept:${proposal.id}`;
    if (decision.kind === 'new') concepts.push({ id: conceptId, name: decision.name, sense: decision.sense });
    items.push({ id: `demo-item:${proposal.id}`, title: proposal.title, statement: proposal.statement, conceptIds: [conceptId], source: { ...proposal.source } });
  }
  return { concepts, items };
}
