import { fireEvent, render, screen } from '@testing-library/react';
import { AppRoutes, type AppRoutesProps } from './AppRoutes';

vi.mock('../features/assistant/AssistantView', () => ({
  AssistantView: () => { throw new Error('模拟助手渲染故障'); }
}));

it('助手渲染故障只显示局部恢复入口，可返回笔记', async () => {
  const onOpenMaterials = vi.fn();
  const props = { pathname: '/assistant', routeDomain: 'materials',
    onOpenMaterials, onOpenNote: vi.fn() } as unknown as AppRoutesProps;
  render(<div data-testid="shell"><AppRoutes {...props} /></div>);
  expect(await screen.findByRole('heading', { name: 'AI 助手暂时不可用' })).toBeInTheDocument();
  expect(screen.getByTestId('shell')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '返回笔记' }));
  expect(onOpenMaterials).toHaveBeenCalledOnce();
});
