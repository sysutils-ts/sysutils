import fs from "node:fs";
import semanticRelease from "semantic-release";

const githubOutput = process.env.GITHUB_OUTPUT;

const result = await semanticRelease({
  dryRun: true,
  noCi: false,
  branches: ["main"],
  tagFormat: "v${version}",
});

function setOutput(lines) {
  if (githubOutput) {
    fs.appendFileSync(githubOutput, lines, "utf8");
  } else {
    process.stdout.write(lines);
  }
}

if ((result || {}).nextRelease) {
  setOutput("version=" + result.nextRelease.version + "\nreleased=true\n");
} else {
  setOutput("released=false\n");
}
