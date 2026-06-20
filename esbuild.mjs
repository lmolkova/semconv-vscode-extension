import { build, context } from "esbuild";

const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  target: "node18",
  format: "cjs",
  sourcemap: true,
  // vscode is provided by the host at runtime and must never be bundled.
  external: ["vscode"],
  logLevel: "info",
};

const builds = [
  { ...common, entryPoints: ["client/src/extension.ts"], outfile: "out/client/extension.js" },
  { ...common, entryPoints: ["server/src/server.ts"], outfile: "out/server/server.js" },
];

if (watch) {
  for (const cfg of builds) {
    const ctx = await context(cfg);
    await ctx.watch();
  }
  console.log("esbuild watching...");
} else {
  await Promise.all(builds.map((cfg) => build(cfg)));
}
