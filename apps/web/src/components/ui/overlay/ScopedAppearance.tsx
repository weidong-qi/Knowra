import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';

/** 将局部外观传给 portal，不修改全局主题；业务方只传外观相关属性。 */
export type ScopedAppearance = HTMLAttributes<HTMLDivElement> & {
  [attribute: `data-${string}`]: string | number | boolean | undefined;
};

const ScopedAppearanceContext = createContext<ScopedAppearance | null>(null);

/** 内层 provider 替换外层作用域；传 null 可显式恢复默认外观。 */
export function ScopedAppearanceProvider({ value, children }: {
  value: ScopedAppearance | null;
  children: ReactNode;
}) {
  return <ScopedAppearanceContext.Provider value={value}>{children}</ScopedAppearanceContext.Provider>;
}

export function useScopedAppearance(): ScopedAppearance | null {
  return useContext(ScopedAppearanceContext);
}
