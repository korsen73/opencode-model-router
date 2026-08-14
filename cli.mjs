// CLI entrypoint for router subcommands.
// Usage: node cli.mjs status | refresh-models | diagnostics | decide <agent>
//
// Kept dependency-free; loads the TS modules via the compiled JS (the router
// is TS, so we run it through node with the TS files imported directly when
// the host supports it, or via tsx. For simplicity the plugin runs these
// functions in-process; this CLI is primarily for operator use.

import { loadConfig, decide, statusReport, diagnostics, refreshModels } from "./src/router.ts";

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const config = await loadConfig();
  switch (cmd) {
    case "status": {
      const r = await statusReport();
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "refresh-models": {
      const r = await refreshModels(config);
      console.log(JSON.stringify(r));
      break;
    }
    case "diagnostics": {
      const r = await diagnostics();
      console.log(JSON.stringify(r, null, 2));
      break;
    }
    case "decide": {
      if (!arg) {
        console.error("usage: decide <agent>");
        process.exit(1);
      }
      const d = await decide(config, arg);
      console.log(JSON.stringify(d, null, 2));
      break;
    }
    default:
      console.error("usage: cli.mjs <status|refresh-models|diagnostics|decide <agent>>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
