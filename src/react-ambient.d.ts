declare module "react" {
  export type ReactElement = unknown;
  export type ReactNode = unknown;

  export type Context<T> = {
    Provider: unknown;
  };

  export function createContext<T>(defaultValue: T): Context<T>;
  export function createElement(
    type: unknown,
    props: Record<string, unknown> | null,
    ...children: unknown[]
  ): ReactElement;
  export function useContext<T>(context: Context<T>): T;
  export function useEffect(
    effect: () => void | (() => void),
    deps?: readonly unknown[],
  ): void;
  export function useMemo<T>(factory: () => T, deps?: readonly unknown[]): T;
  export function useState<T>(
    initialState: T | (() => T),
  ): [T, (nextState: T | ((currentState: T) => T)) => void];
}
