import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("public/assets", { recursive: true, force: true });
await mkdir("public/assets", { recursive: true });
const result = await Bun.build({
  entrypoints: ["frontend/src/main.tsx"],
  outdir: "public/assets",
  target: "browser",
  minify: true,
  naming: "app.[ext]",
  define: { "process.env.NODE_ENV": '"production"' },
});
if (!result.success) throw new AggregateError(result.logs, "Frontend build failed");
await copyFile("frontend/index.html", "public/index.html");
console.log(`Frontend built: ${result.outputs.map((o) => o.path).join(", ")}`);
