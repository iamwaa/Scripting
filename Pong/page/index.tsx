import { Button, Navigation, NavigationStack, Script, ZStack } from "scripting";
import { MapSelectionContextProvider } from "../context/MapSelection";
import { MonitorProvider } from "../context/Monitor";
import { View as MapView } from "./map";
import { View as SheetView } from "./sheet";

export function View() {
  const dismiss = Navigation.useDismiss();
  return (
    <NavigationStack>
      <MonitorProvider>
        <MapSelectionContextProvider>
          <ZStack alignment={"bottom"} ignoresSafeArea={true}>
            <MapView
              scaleEffect={1.1}
              navigationTitle={Script.name}
              navigationBarTitleDisplayMode={"inline"}
              toolbar={{
                cancellationAction: [
                  <Button title="关闭" systemImage="xmark" action={dismiss} />,
                ],
              }}
            />
            <SheetView padding={true} />
          </ZStack>
        </MapSelectionContextProvider>
      </MonitorProvider>
    </NavigationStack>
  );
}
