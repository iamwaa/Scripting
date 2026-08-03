import { Intent } from "scripting"
import { runChat } from "./launch"

runChat([...(Intent.fileURLsParameter ?? []), ...(Intent.imagePathsParameter ?? [])])
