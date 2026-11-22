import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// All COMS pages are dynamic (per-user, permission-checked); no ISR cache is needed.
export default defineCloudflareConfig({});
