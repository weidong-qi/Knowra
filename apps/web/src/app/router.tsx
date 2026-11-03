import { useHashNavigation } from './useHashNavigation';
// V4-04 内置轻量 router
//
// 仅用于 V4 内部页面切换（/ 与 /showcase），不依赖第三方 router。
// 任何包含 react-router-dom / next/router 的依赖都会触犯
// scripts/check-v4-boundaries.mjs 的"web-core 不得依赖 apps"规则。
//
// 用 hash 路由（URL 锚点）以兼容 Vite dev server 的 history fallback。

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode
} from 'react';

interface RouterContextValue {
  pathname: string;
  navigate(to: string): void;
  back?(): void;
  forward?(): void;
  canGoBack?: boolean;
  canGoForward?: boolean;
}

const RouterContext = createContext<RouterContextValue | null>(null);

const FALLBACK_LOCATION: RouterContextValue = Object.freeze({
  pathname: '/',
  navigate: () => undefined
});

export function useLocation(): RouterContextValue {
  return useContext(RouterContext) ?? FALLBACK_LOCATION;
}

export { RouterContext };

export function useNavigate(): (to: string) => void {
  return useLocation().navigate;
}

export interface RouterProviderProps {
  children: ReactNode;
  /** 由 useHashLocation / useStaticLocation 注入。 */
  location: RouterContextValue;
}

export function RouterProvider({ children, location }: RouterProviderProps) {
  return <RouterContext.Provider value={location}>{children}</RouterContext.Provider>;
}

export function Link({
  to,
  children,
  ...rest
}: { to: string; children: ReactNode } & Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const { pathname, navigate } = useLocation();
  const isActive = stripQuery(pathname) === stripQuery(to);
  return (
    <a
      href={`#${to}`}
      aria-current={isActive ? 'page' : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}

export interface RouteProps {
  path: string;
  element: ReactElement;
}

export interface RouterOutletProps {
  routes: RouteProps[];
  fallback?: ReactElement;
}

export function RouterOutlet({ routes, fallback }: RouterOutletProps) {
  const { pathname } = useLocation();
  const matched = routes.find((route) => matchPath(pathname, route.path));
  return matched ? matched.element : (fallback ?? <></>);
}

export const useHashLocation = useHashNavigation;

export function useStaticLocation(pathname = '/'): RouterContextValue {
  const navigate = useCallback((to: string) => {
    throw new Error(`useStaticLocation does not support navigation (target: ${to}).`);
  }, []);
  return useMemo(() => ({ pathname, navigate }), [pathname, navigate]);
}

function matchPath(current: string, target: string): boolean {
  current = stripQuery(current);
  target = stripQuery(target);
  if (target === current) return true;
  if (target.endsWith('/*')) {
    const prefix = target.slice(0, -2);
    return current === prefix || current.startsWith(`${prefix}/`);
  }
  return false;
}

function stripQuery(pathname: string): string {
  return pathname.split('?')[0] || '/';
}
