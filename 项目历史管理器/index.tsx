import { Navigation, Script } from "scripting"
import { ProjectListPage } from "./pages/ProjectListPage"

async function run() {
  await Navigation.present({
    element: <ProjectListPage />,
    modalPresentationStyle: "fullScreen",
  })
  Script.exit()
}

run()
