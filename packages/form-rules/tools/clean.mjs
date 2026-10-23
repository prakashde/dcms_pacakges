/** Build cleanup utility; removes generated dist output so qualification starts from source rather than stale artifacts. */
import { rm } from "node:fs/promises";
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true
});
