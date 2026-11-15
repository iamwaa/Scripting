import { Navigation, Script } from 'scripting'
import App from './pages/App'

async function run() {
  await Navigation.present(<App />)
  Script.exit()
}

void run()
