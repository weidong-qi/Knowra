import { readFileSync } from 'node:fs';

const css = readFileSync('src/components/ui/button/Button.module.css', 'utf8');

// 直接加载生产 CSS，保留层叠顺序；只解除 CSS Modules 的全局标记。
// jsdom 不替代浏览器材质验收，这里验证禁用态不会被后置外观选择器覆盖。
describe('按钮外观的禁用反馈', () => {
  const properties = ['color', 'background-color', 'border-top-color', 'box-shadow', 'backdrop-filter'];
  const snapshot = (button) => {
    const style = getComputedStyle(button);
    return properties.map(property => style.getPropertyValue(property));
  };
  for (const mode of ['light', 'dark']) {
    for (const [attribute, appearance, variant] of [
      ['data-button-style', 'paper', 'primary'],
      ['data-button-style', 'frost', 'primary'],
      ['data-default-button-style', 'soft', ''],
      ['data-default-button-style', 'glass', '']
    ]) {
      for (const disabled of ['disabled', 'data-disabled']) {
        it(`${mode} ${appearance} 保留 ${disabled} 的中性反馈`, () => {
          const style = document.createElement('style');
          style.textContent = css.replace(/:global\(([^)]+)\)/g, '$1');
          const scope = document.createElement('div');
          scope.setAttribute('data-ni-mode', mode);
          const button = document.createElement('button');
          button.className = `btn ${variant}`;
          button.setAttribute(disabled, '');
          scope.append(button);
          document.head.append(style);
          document.body.append(scope);
          try {
            const baseline = snapshot(button);
            expect(getComputedStyle(button).boxShadow).toBe('none');
            scope.setAttribute(attribute, appearance);
            expect(snapshot(button)).toEqual(baseline);
            for (const state of disabled === 'data-disabled' ? ['data-hovered', 'data-pressed'] : []) {
              button.setAttribute(state, '');
              expect(snapshot(button)).toEqual(baseline);
              button.removeAttribute(state);
            }
            button.removeAttribute(disabled);
            expect(getComputedStyle(button).boxShadow).not.toBe('none');
          } finally {
            scope.remove();
            style.remove();
          }
        });
      }
    }
  }
});
