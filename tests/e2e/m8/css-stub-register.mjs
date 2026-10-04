import { register } from "node:module";

// The renderer module imports its stylesheet for the editor (`import "./page-renderer.css"`); Node
// cannot, and the Node-side fixture renderers need only the markup. This makes that import a no-op.
register("./css-stub-hooks.mjs", import.meta.url);
