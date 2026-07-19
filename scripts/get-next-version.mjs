import semanticRelease from "semantic-release";

const result = await semanticRelease(
  {
    dryRun: true,
    noCi: false,
    branches: ["main"],
    tagFormat: "v${version}",
  },
  { stdout: process.stderr, stderr: process.stderr },
);

if (result && result.nextRelease) {
  console.log(`version=${result.nextRelease.version}`);
  console.log(`released=true`);
} else {
  console.log("released=false");
}
