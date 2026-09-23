import { useCallback, useReducer } from "react";

export type AppTool =
  | "provider"
  | "workflow"
  | "assets"
  | "creator-dashboard"
  | "system-health"
  | "author-delivery"
  | "data"
  | "memory"
  | "timeline"
  | "branches"
  | "authoring-hub"
  | "story-bible"
  | "continuity-radar"
  | "consistency"
  | "search"
  | "production-tasks";

export interface AppShellState {
  activeTool: AppTool | null;
  navigationOpen: boolean;
  commandOpen: boolean;
}

export type AppShellAction =
  | { type: "open-tool"; tool: AppTool }
  | { type: "close-tool"; tool?: AppTool }
  | { type: "open-navigation" }
  | { type: "close-navigation" }
  | { type: "toggle-navigation" }
  | { type: "open-command" }
  | { type: "close-command" }
  | { type: "toggle-command" };

export const initialAppShellState: AppShellState = {
  activeTool: null,
  navigationOpen: false,
  commandOpen: false,
};

export function appShellReducer(state: AppShellState, action: AppShellAction): AppShellState {
  switch (action.type) {
    case "open-tool":
      return { activeTool: action.tool, navigationOpen: false, commandOpen: false };
    case "close-tool":
      return !action.tool || state.activeTool === action.tool
        ? { ...state, activeTool: null }
        : state;
    case "open-navigation":
      return { activeTool: null, navigationOpen: true, commandOpen: false };
    case "close-navigation":
      return state.navigationOpen ? { ...state, navigationOpen: false } : state;
    case "toggle-navigation":
      return state.navigationOpen
        ? { ...state, navigationOpen: false }
        : { activeTool: null, navigationOpen: true, commandOpen: false };
    case "open-command":
      return { activeTool: null, navigationOpen: false, commandOpen: true };
    case "close-command":
      return state.commandOpen ? { ...state, commandOpen: false } : state;
    case "toggle-command":
      return state.commandOpen
        ? { ...state, commandOpen: false }
        : { activeTool: null, navigationOpen: false, commandOpen: true };
  }
}

export function useAppShellState() {
  const [state, dispatch] = useReducer(appShellReducer, initialAppShellState);
  const openTool = useCallback((tool: AppTool) => dispatch({ type: "open-tool", tool }), []);
  const closeTool = useCallback((tool?: AppTool) => dispatch({ type: "close-tool", tool }), []);
  const openNavigation = useCallback(() => dispatch({ type: "open-navigation" }), []);
  const closeNavigation = useCallback(() => dispatch({ type: "close-navigation" }), []);
  const toggleNavigation = useCallback(() => dispatch({ type: "toggle-navigation" }), []);
  const openCommand = useCallback(() => dispatch({ type: "open-command" }), []);
  const closeCommand = useCallback(() => dispatch({ type: "close-command" }), []);
  const toggleCommand = useCallback(() => dispatch({ type: "toggle-command" }), []);

  return {
    state,
    openTool,
    closeTool,
    openNavigation,
    closeNavigation,
    toggleNavigation,
    openCommand,
    closeCommand,
    toggleCommand,
  };
}
