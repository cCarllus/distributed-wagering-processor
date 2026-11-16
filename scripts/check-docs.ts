import { stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

const root = process.cwd();
const files = ["README.md", "ARCHITECTURE.md"];
for (const directory of ["guide", "openspec"]) {
  for await (const file of new Bun.Glob(`${directory}/**/*.md`).scan(root)) files.push(file);
}

let checked = 0;
const failures: string[] = [];
for (const file of files) {
  const content = await Bun.file(file).text();
  const links = [
    ...content.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g),
    ...content.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)="([^"]+)"/g),
  ];
  for (const match of links) {
    const href = match[1];
    if (!href || /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(href)) continue;
    try {
      const localPath = decodeURIComponent(href.split(/[?#]/)[0] ?? "");
      const target = resolve(dirname(resolve(root, file)), localPath);
      const fromRoot = relative(root, target);
      if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`)) {
        throw new Error("target outside repository");
      }
      await stat(target);
      checked++;
    } catch {
      failures.push(`${file}: missing or invalid local target ${href}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exitCode = 1;
} else {
  console.log(`Documentation: ${files.length} Markdown files, ${checked} local targets checked.`);
}
