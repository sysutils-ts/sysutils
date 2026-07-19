import fs from "node:fs";
import path from "node:path";

const outDir = path.resolve(process.cwd(), "tmp-platform-stubs");
const version = process.argv[2] || "0.0.0";

const platforms = [
  ["darwin", "arm64"],
  ["darwin", "x64"],
  ["linux", "arm64"],
  ["linux", "x64"],
  ["win32", "arm64"],
  ["win32", "x64"],
];

fs.mkdirSync(outDir, { recursive: true });

const rootPkg = {
  name: "@sysutils/platform-stubs-root",
  version: "0.0.0",
  private: true,
  description:
    "Temporary workspace root for bootstrapping @sysutils/ps-* platform packages.",
  workspaces: platforms.map(
    ([platform, arch]) =>
      `./${`@sysutils/ps-${platform}-${arch}`
        .replace("@", "")
        .replace("/", "-")}`,
  ),
};

fs.writeFileSync(
  path.join(outDir, "package.json"),
  JSON.stringify(rootPkg, null, 2) + "\n",
  "utf8",
);

for (const [platform, arch] of platforms) {
  const name = `@sysutils/ps-${platform}-${arch}`;
  const dir = path.join(outDir, name.replace("@", "").replace("/", "-"));
  fs.mkdirSync(dir, { recursive: true });

  const pkg = {
    name,
    version,
    description: `Stub package for ${name}. This reserves the package name and marks the supported OS/CPU. The first real release will be published by CI with the native binaries.`,
    os: [platform],
    cpu: [arch],
    files: ["README.md"],
    publishConfig: {
      access: "public",
      registry: "https://registry.npmjs.org/",
    },
    repository: {
      type: "git",
      url: "git+https://github.com/sysutils-ts/sysutils.git",
      directory: "packages/ps",
    },
  };

  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(pkg, null, 2) + "\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(dir, "README.md"),
    `# ${name}\n\nStub package that reserves the platform-specific package name for \`@sysutils/ps\`.\nThe actual native binaries are built and published by CI.\n`,
    "utf8",
  );

  console.log(`Created ${dir}`);
}

console.log(`\nTo publish all stubs with one command (using npm workspaces):\n`);
console.log(`  cd tmp-platform-stubs`);
console.log(`  npm publish --workspaces --access public`);
console.log(`\nIf you have a granular token with bypass 2FA, set it first:\n`);
console.log(`  $env:NODE_AUTH_TOKEN = "npm_..."   # PowerShell`);
console.log(`  export NODE_AUTH_TOKEN=npm_...     # bash`);
console.log(`  cd tmp-platform-stubs && npm publish --workspaces --access public`);
console.log(`\nOr publish each one individually:\n`);
console.log(`  for d in tmp-platform-stubs/*; do (cd "$d" && npm publish --access public); done`);
