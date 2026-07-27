import { Navigation, Script } from "scripting"
import { HomePage } from "./pages/HomePage"

async function run() {
  await Navigation.present({
    element: <HomePage />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
