import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { McpConnectionDialog } from './McpConnectionDialog';
import { connectionEvidence } from './mcpConnection';
import { externalClients, type McpAuditEntry, type McpOverview, type McpPairing } from './externalClients';

vi.mock('./externalClients', async original => ({ ...await original<typeof import('./externalClients')>(),
  externalClients: { overview: vi.fn(), audit: vi.fn(), create: vi.fn() } }));
const pairing: McpPairing = { pairingId: 'p-1', label: 'Codex', spaceId: 's-1', scope: { kind: 'library' }, excludedNoteIds: [],
  createdAt: '2026-01-01T00:00:00Z', expiresAt: '2026-12-01T00:00:00Z', revokedAt: null, lastUsedAt: null, calls: 0,
  allowPropose: false, allowKnowledgeRead: false, knowledgeReadConfirmedAt: null, status: 'active', pairingFile: '/data/private/p-1.json' };
const adapter = { command: '/Applications/Knowra', args: ['/app/adapter.mjs'], env: {} };
const overview: McpOverview = { items: [pairing], adapter, aiEnabled: true, egressEnabled: true, proposalsEnabled: false };
const success: McpAuditEntry = { at: '2026-10-15T12:00:00Z', event: 'call', status: 'ok', tool: 'notes_search' };
const show = () => render(<McpConnectionDialog pairing={pairing} adapter={adapter} initialClient="codex" onClose={vi.fn()} />);
const inspect = () => fireEvent.click(screen.getByRole('button', { name: '检查连接' }));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(externalClients.overview).mockResolvedValue(overview);
  vi.mocked(externalClients.audit).mockResolvedValue([]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

it('复制只确认剪贴板，不请求接口、不创建配对、不把配置标为已连接', async () => {
  show();
  expect(screen.getByLabelText('codex 配置')).toHaveTextContent('[mcp_servers.knowra]');
  expect(screen.queryByLabelText('claude 配置')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '复制 codex 配置' }));
  expect(await screen.findByText(/复制不代表连接成功/)).toBeInTheDocument();
  expect(externalClients.overview).not.toHaveBeenCalled(); expect(externalClients.audit).not.toHaveBeenCalled(); expect(externalClients.create).not.toHaveBeenCalled();
});

it('检查分开报告接口、授权和未见调用证据，并允许重复检查', async () => {
  show(); inspect();
  const result = await screen.findByRole('status', { name: '连接检查结果' });
  expect(result).toHaveTextContent('本地设置接口可用');
  expect(result).toHaveTextContent('配对有效，AI 与外发开关已开启');
  expect(result).toHaveTextContent('不能据此判定连接失败');
  expect(externalClients.audit).toHaveBeenCalledWith('p-1', 50);
  vi.mocked(externalClients.audit).mockResolvedValue([success]); inspect();
  await waitFor(() => expect(screen.getByRole('status', { name: '连接检查结果' })).toHaveTextContent('曾成功调用 notes_search'));
  expect(screen.getByRole('status', { name: '连接检查结果' })).toHaveTextContent('此记录不证明当前仍能调用');
  expect(externalClients.create).not.toHaveBeenCalled();
});

it('准入次数与失败记录都不能冒充成功；使用最新成功记录', () => {
  const check = { overview, pairing: { ...pairing, calls: 8, lastUsedAt: success.at }, checkedAt: success.at,
    audit: [{ ...success, status: 'error' }, { ...success, event: 'created' }] };
  expect(connectionEvidence(check).success).toBeNull();
  expect(connectionEvidence({ ...check, audit: [{ ...success, at: '2026-01-01' }, success] }).success).toEqual(success);
});

it.each(['expired', 'revoked'] as const)('检查发现配对 %s 后隐藏失效配置，但历史成功不会丢失', async status => {
  vi.mocked(externalClients.overview).mockResolvedValue({ ...overview, items: [{ ...pairing, status }] });
  vi.mocked(externalClients.audit).mockResolvedValue([success]); show(); inspect();
  const result = await screen.findByRole('status', { name: '连接检查结果' });
  expect(result).toHaveTextContent(status === 'expired' ? '配对已过期' : '配对已撤销');
  expect(result).toHaveTextContent('曾成功调用');
  expect(screen.queryByLabelText('codex 配置')).not.toBeInTheDocument();
});

it('丢失配对不会继续提供旧配置', async () => {
  vi.mocked(externalClients.overview).mockResolvedValue({ ...overview, items: [] }); show(); inspect();
  expect(await screen.findByRole('status', { name: '连接检查结果' })).toHaveTextContent('找不到此配对');
  expect(screen.queryByLabelText('codex 配置')).not.toBeInTheDocument();
});

it.each([{ aiEnabled: false, message: 'AI 功能未开启' }, { egressEnabled: false, message: '外发已被紧急停止' }])('明确显示全局阻断 $message', async ({ message, ...flags }) => {
  vi.mocked(externalClients.overview).mockResolvedValue({ ...overview, ...flags }); show(); inspect();
  expect(await screen.findByRole('status', { name: '连接检查结果' })).toHaveTextContent(message);
});

it('读取失败不猜测离线；审计失败仍保留已核实的接口状态，均可重试', async () => {
  vi.mocked(externalClients.overview).mockRejectedValueOnce(new Error('private diagnostic details'));
  show(); inspect();
  expect(await screen.findByRole('alert')).toHaveTextContent('尚不能判断连接状态');
  expect(screen.queryByText('private diagnostic details')).not.toBeInTheDocument();
  vi.mocked(externalClients.audit).mockRejectedValueOnce(new Error('audit failed')); inspect();
  expect(await screen.findByRole('status', { name: '连接检查结果' })).toHaveTextContent('调用记录读取失败');
  inspect();
  await waitFor(() => expect(screen.getByRole('status', { name: '连接检查结果' })).toHaveTextContent('最近记录中尚无成功工具调用'));
});

it('检查返回新路径后复制新配置，说明需用户手动替换', async () => {
  vi.mocked(externalClients.overview).mockResolvedValue({ ...overview, adapter: { ...adapter, command: '/new/Knowra' }, items: [{ ...pairing, pairingFile: '/new/p-1.json' }] });
  show(); inspect(); await screen.findByRole('status', { name: '连接检查结果' });
  expect(screen.getByLabelText('codex 配置')).toHaveTextContent('/new/Knowra');
  fireEvent.click(screen.getByRole('button', { name: '复制 codex 配置' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('/new/p-1.json')));
  fireEvent.click(screen.getByText('连接遇到问题？'));
  expect(screen.getByText(/移动或更新应用后路径变化/)).toHaveTextContent('手动替换');
});

it('请求进行中禁用重复检查；关闭后迟到响应不会污染重新打开的界面', async () => {
  let finish!: (value: McpOverview) => void;
  vi.mocked(externalClients.overview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const first = show(); inspect(); inspect();
  expect(externalClients.overview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '检查连接' })).toBeDisabled();
  first.unmount(); show();
  await act(async () => finish({ ...overview, items: [] }));
  expect(screen.queryByRole('status', { name: '连接检查结果' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('codex 配置')).toBeInTheDocument();
});

it('剪贴板失败提供手动复制路径', async () => {
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied')); show();
  fireEvent.click(screen.getByRole('button', { name: '复制 codex 配置' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请手动选择');
  expect(within(screen.getByRole('dialog')).getByLabelText('codex 配置')).toBeInTheDocument();
});


it('重新检查期间不重新暴露已知失效的旧配置', async () => {
  vi.mocked(externalClients.overview).mockResolvedValueOnce({ ...overview, items: [{ ...pairing, status: 'revoked' }] });
  show(); inspect(); await screen.findByRole('status', { name: '连接检查结果' });
  let finish!: (value: McpOverview) => void;
  vi.mocked(externalClients.overview).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  inspect();
  expect(screen.queryByLabelText('codex 配置')).not.toBeInTheDocument();
  await act(async () => finish({ ...overview, items: [{ ...pairing, status: 'revoked' }] }));
  expect(screen.queryByLabelText('codex 配置')).not.toBeInTheDocument();
});


it('检查期间禁用复制，路径替换后迟到的旧剪贴板结果不能标为已复制', async () => {
  let finishCopy!: () => void;
  let finishOverview!: (value: McpOverview) => void;
  vi.mocked(navigator.clipboard.writeText).mockImplementationOnce(() => new Promise(resolve => { finishCopy = resolve; }));
  vi.mocked(externalClients.overview).mockImplementationOnce(() => new Promise(resolve => { finishOverview = resolve; }));
  show();
  const copy = screen.getByRole('button', { name: '复制 codex 配置' });
  fireEvent.click(copy); inspect();
  expect(copy).toBeDisabled(); fireEvent.click(copy);
  expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
  await act(async () => finishOverview({ ...overview, adapter: { ...adapter, command: '/updated/Knowra' } }));
  expect(screen.getByLabelText('codex 配置')).toHaveTextContent('/updated/Knowra');
  await act(async () => finishCopy());
  expect(screen.queryByText(/已复制。请在客户端保存/)).not.toBeInTheDocument();
  expect(copy).toBeEnabled();
  fireEvent.click(copy);
  expect(await screen.findByText(/已复制。请在客户端保存/)).toBeInTheDocument();
  expect(navigator.clipboard.writeText).toHaveBeenLastCalledWith(expect.stringContaining('/updated/Knowra'));
});
