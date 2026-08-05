import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { DoseRecord, Metric, Observation, Protocol } from "../types";
import type { ColumnMapping } from "../stats/csv";
import { DEFAULT_CONFOUNDERS } from "../confounders";

export interface LockedProtocol {
  protocol: Protocol;
  hash: string;
  lockedAt: string; // ISO timestamp
  /** True when this amendment was made after the intervention phase began. Permanent (§4.1). */
  afterStart: boolean;
}

export interface AppState {
  metrics: Metric[];
  observations: Observation[];
  doses: DoseRecord[];
  confounders: { id: string; label: string }[];
  /** Persisted so re-import of the same export format is one click (§2). */
  savedMapping: ColumnMapping | null;
  /** Draft protocol under construction. Read-only once locked (§4.1). */
  draft: Partial<Protocol>;
  /** Version history. The last entry is current; length - 1 is the amendment count. */
  locks: LockedProtocol[];
  plannedInterventionDays: number;
  adherence: number;
  /** §3.5: recorded acknowledgment that the user proceeded while underpowered. */
  underpoweredAck: boolean;
  efficacyAck: boolean;
}

export const STORAGE_KEY = "pipeline.v1";
/** The key used before the product was renamed. Read once, never written. */
export const LEGACY_STORAGE_KEY = "runsheet.v1";

export const initialState: AppState = {
  metrics: [],
  observations: [],
  doses: [],
  confounders: DEFAULT_CONFOUNDERS.map((c) => ({ id: c.id, label: c.label })),
  savedMapping: null,
  draft: {},
  locks: [],
  plannedInterventionDays: 30,
  adherence: 1,
  underpoweredAck: false,
  efficacyAck: false,
};

export type Action =
  | { type: "import"; observations: Observation[]; metrics: Metric[]; mapping: ColumnMapping }
  | { type: "upsertObservation"; observation: Observation }
  | { type: "setDose"; dose: DoseRecord }
  | { type: "addConfounder"; id: string; label: string }
  | { type: "patchDraft"; patch: Partial<Protocol> }
  | { type: "setPlan"; days?: number; adherence?: number }
  | { type: "ackUnderpowered"; value: boolean }
  | { type: "ackEfficacy"; value: boolean }
  | { type: "lock"; lock: LockedProtocol }
  | { type: "replaceAll"; state: AppState }
  | { type: "reset" };

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "import":
      return {
        ...state,
        observations: mergeObservations(state.observations, action.observations),
        metrics: mergeMetrics(state.metrics, action.metrics),
        savedMapping: action.mapping,
      };

    case "upsertObservation": {
      const rest = state.observations.filter((o) => o.date !== action.observation.date);
      return {
        ...state,
        observations: [...rest, action.observation].sort((a, b) => a.date.localeCompare(b.date)),
      };
    }

    case "setDose": {
      const rest = state.doses.filter((d) => d.date !== action.dose.date);
      return { ...state, doses: [...rest, action.dose].sort((a, b) => a.date.localeCompare(b.date)) };
    }

    case "addConfounder":
      if (state.confounders.some((c) => c.id === action.id)) return state;
      return { ...state, confounders: [...state.confounders, { id: action.id, label: action.label }] };

    case "patchDraft":
      return { ...state, draft: { ...state.draft, ...action.patch } };

    case "setPlan":
      return {
        ...state,
        plannedInterventionDays: action.days ?? state.plannedInterventionDays,
        adherence: action.adherence ?? state.adherence,
      };

    case "ackUnderpowered":
      return { ...state, underpoweredAck: action.value };

    case "ackEfficacy":
      return { ...state, efficacyAck: action.value };

    case "lock":
      return { ...state, locks: [...state.locks, action.lock] };

    case "replaceAll":
      return action.state;

    case "reset":
      return initialState;
  }
}

/** Imports never clobber a hand-entered day silently; existing values win per metric. */
function mergeObservations(existing: Observation[], incoming: Observation[]): Observation[] {
  const byDate = new Map(existing.map((o) => [o.date, o]));
  for (const inc of incoming) {
    const prior = byDate.get(inc.date);
    if (!prior) {
      byDate.set(inc.date, inc);
      continue;
    }
    byDate.set(inc.date, {
      ...prior,
      values: { ...inc.values, ...prior.values },
      confounders: [...new Set([...prior.confounders, ...inc.confounders])],
    });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function mergeMetrics(existing: Metric[], incoming: Metric[]): Metric[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) if (!byId.has(m.id)) byId.set(m.id, m);
  return [...byId.values()];
}

export function loadState(): AppState {
  try {
    // Fall back to the pre-rename key so a rename never silently drops someone's
    // data. The old entry is left in place rather than deleted; the next save
    // writes the new key, and nothing is destroyed if this build is rolled back.
    const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return initialState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return { ...initialState, ...parsed };
  } catch {
    return initialState;
  }
}

const StateContext = createContext<AppState>(initialState);
const DispatchContext = createContext<Dispatch<Action>>(() => undefined);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked. The app keeps working in memory; export still available.
    }
  }, [state]);

  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export const useStore = () => useContext(StateContext);
export const useDispatch = () => useContext(DispatchContext);

/** The current locked protocol, or null while still a draft. */
export function useLocked(): LockedProtocol | null {
  const { locks } = useStore();
  return useMemo(() => locks[locks.length - 1] ?? null, [locks]);
}
