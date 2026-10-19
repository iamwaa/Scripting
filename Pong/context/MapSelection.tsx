// ============================================================================
// Map selection context (kept for the Map `selection` binding).
// S: Single Purpose — holds the currently tapped marker's value.
// ============================================================================
import { createContext, useObservable } from "scripting";
import type { MapSelectionValue } from "scripting";

export const MapSelectionContext =
  createContext<Observable<MapSelectionValue | null>>();

export function MapSelectionContextProvider({
  children,
}: {
  children: JSX.Element;
}) {
  const selection = useObservable<MapSelectionValue | null>(null);
  return (
    <MapSelectionContext.Provider value={selection}>
      {children}
    </MapSelectionContext.Provider>
  );
}
