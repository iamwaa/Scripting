// ============================================================================
// Map page — renders 哪吒 (Nezha) nodes as geographic markers.
// S: Single Purpose — map presentation; data comes from the Monitor context.
// ============================================================================
import {
  Button,
  Label,
  Map,
  MapScaleView,
  Marker,
  ProgressView,
  useContext,
  useEffect,
  useObservable,
} from "scripting";
import { MapSelectionContext } from "../context/MapSelection";
import { useMonitor } from "../context/Monitor";

export function View() {
  const selection = useContext(MapSelectionContext);
  const monitor = useMonitor();
  const cameraPosition = useObservable<MapCameraPosition>(
    MapCameraPosition.camera({
      centerCoordinate: { latitude: 20, longitude: 30 },
      distance: 42000000,
    }),
  );

  // Center on the user's location once, falling back silently if denied.
  useEffect(() => {
    (async () => {
      try {
        const here = await Location.requestCurrent();
        if (here) {
          cameraPosition.setValue(
            MapCameraPosition.camera({
              centerCoordinate: here,
              distance: 8000000,
            }),
          );
        }
      } catch {
        /* keep the default world view */
      }
    })();
  }, []);

  // When no instance is configured, show a minimal neutral map — no loading spinner.
  const empty = monitor.instance.value == null;

  return (
    <Map
      cameraPosition={cameraPosition}
      selection={selection}
      mapStyle={{ style: "imagery", elevation: "realistic" }}
      controls={<MapScaleView />}
      toolbar={{
        topBarTrailing: empty ? undefined : [<RefreshButton />],
      }}
    >
      {monitor.pins.value.map((pin) => (
        <Marker
          tag={pin.id}
          title={pin.title}
          coordinate={pin.coordinate}
          tint={pin.tint}
        />
      ))}
    </Map>
  );
}

function RefreshButton() {
  const monitor = useMonitor();
  const isLoading = useObservable(false);
  return (
    <Button
      action={async () => {
        isLoading.setValue(true);
        await monitor.reload();
        isLoading.setValue(false);
      }}
    >
      {isLoading.value || monitor.status.value === "loading" ? (
        <ProgressView />
      ) : (
        <Label title={"刷新"} systemImage={"arrow.clockwise"} />
      )}
    </Button>
  );
}
