---
"cyrenex": patch
---

`{ package, path }` locations are only looked up in `node_modules`, like any import: declare the package as a dependency (`"@acme/api": "workspace:*"`) and install. The workspace is no longer scanned.
