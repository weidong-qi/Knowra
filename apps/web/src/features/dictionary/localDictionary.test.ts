import {
  createDictionaryLookup,
  dictionaryComment,
  normalizeDictionaryWord,
  type DictionaryShard
} from './localDictionary';

it('清理选区标点和 PDF 断行，保留词组；不把句子和路径当作词语', () => {
  expect(normalizeDictionaryWord(' “Gradients,” ')).toBe('gradients');
  expect(normalizeDictionaryWord('"Gradients,"')).toBe('gradients');
  expect(normalizeDictionaryWord('convo-\nlution')).toBe('convolution');
  expect(normalizeDictionaryWord('flat   minima')).toBe('flat minima');
  expect(normalizeDictionaryWord('../secret')).toBeNull();
  expect(normalizeDictionaryWord('这是中文')).toBeNull();
  expect(normalizeDictionaryWord('This is a very long sentence about models.')).toBeNull();
});

it('从词库还原复数和不规则词形，共享分片且保存本次看到的释义', async () => {
  const read = vi.fn(async (prefix: string): Promise<DictionaryShard> => {
    if (prefix === 'gr')
      return { gradients: ['', '复数', '', 'gradient'], gradient: ['ˈɡreɪdiənt', 'n. 梯度\na. 渐升的', '', ''] };
    if (prefix === 'mi') return { minima: ['', '极小值', '', 'minimum'], minimum: ['', 'n. 最小值', '', ''] };
    return {};
  });
  const lookup = createDictionaryLookup(read);
  const entry = await lookup('Gradients');
  expect(entry).toMatchObject({
    query: 'gradients',
    word: 'gradient',
    meanings: ['n. 梯度', 'a. 渐升的'],
    language: 'zh'
  });
  expect(await lookup('minimum')).toMatchObject({ word: 'minimum' });
  expect(await lookup('minima')).toMatchObject({ word: 'minimum' });
  expect(await lookup('gradient')).toEqual({ ...entry!, query: 'gradient' });
  expect(read).toHaveBeenCalledTimes(2);
  expect(dictionaryComment(entry!, 'n. 梯度')).toBe('词典 · ECDICT\ngradient /ˈɡreɪdiənt/\nn. 梯度');
});

it('未知词返回未收录，分片读取失败可重试；缺少原形时保留原词释义', async () => {
  const read = vi
    .fn()
    .mockRejectedValueOnce(new Error('读取失败'))
    .mockResolvedValue({ gradients: ['', 'n. 梯度的复数', '', 'gradient'] });
  const lookup = createDictionaryLookup(read);
  await expect(lookup('gradients')).rejects.toThrow('读取失败');
  expect(await lookup('gradients')).toMatchObject({ word: 'gradients', meanings: ['n. 梯度的复数'] });
  expect(await lookup('gradient')).toBeNull();
  expect(await lookup('中文')).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

it('没有中文时明确返回英文释义，损坏条目不当作有效查询结果', async () => {
  const lookup = createDictionaryLookup(
    async () => ({ word: ['', '', 'A unit of language.', ''], broken: [] }) as never
  );
  expect(await lookup('word')).toMatchObject({ meanings: ['A unit of language.'], language: 'en' });
  await expect(lookup('broken')).rejects.toThrow('条目无效');
});
