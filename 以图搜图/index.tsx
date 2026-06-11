import { Navigation, Script } from "scripting"

import { App } from "./HomePage"

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

run()
