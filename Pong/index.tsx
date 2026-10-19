import { Navigation, Script } from "scripting";
import { View } from "./page";

(async () => {
  await Navigation.present({
    element: <View />,
    modalPresentationStyle: "overFullScreen",
  });
})()
  .catch((e) => console.error(e))
  .finally(Script.exit);
