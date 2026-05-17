import { lstat, readFile, readlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  shellQuote
} from "../../../shellCommands.js";
import {
  isMissingPathError,
  normalizeText,
  pathExists
} from "../../core.js";

const SESSION_PROVISION_PACKAGE_SCRIPT = "jskit:provision-session";
const SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT = "jskit:finalization-guard";

const PACKAGE_SCRIPT_EXISTS_NODE = [
  "const fs = require('node:fs');",
  "const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
  "const scripts = packageJson.scripts || {};",
  "process.exit(Object.prototype.hasOwnProperty.call(scripts, process.argv[1]) ? 0 : 1);"
].join("");

const LINKED_JSKIT_PACKAGES = Object.freeze([
  "@jskit-ai/jskit-cli",
  "@jskit-ai/kernel",
  "@jskit-ai/users-web"
]);

function isEnabledValue(value = "") {
  return [
    "1",
    "true",
    "yes",
    "on",
    "auto"
  ].includes(normalizeText(value).toLowerCase());
}

function isDisabledValue(value = "") {
  return [
    "",
    "0",
    "false",
    "no",
    "off"
  ].includes(normalizeText(value).toLowerCase());
}

function packageScriptRecordName(scriptName = "") {
  return normalizeText(scriptName).replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

function repoRootFromPackageSource(packageSource = "") {
  const source = normalizeText(packageSource);
  if (!source) {
    return "";
  }
  const parent = path.basename(path.dirname(source));
  if (parent === "packages" || parent === "tooling") {
    return path.resolve(source, "..", "..");
  }
  return "";
}

function shellEnvironment(assignments = {}) {
  return Object.entries(assignments)
    .filter(([, value]) => normalizeText(value))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
}

function sessionHookEnvironment({
  developmentRepoRoot = "",
  scriptName = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const env = {
    JSKIT_SESSION_ID: session.sessionId,
    JSKIT_SESSION_PACKAGE_SCRIPT: scriptName,
    JSKIT_SESSION_ROOT: session.sessionRoot,
    JSKIT_TARGET_ROOT: targetRoot || session.targetRoot,
    JSKIT_WORKTREE_ROOT: worktreePath
  };

  if (developmentRepoRoot) {
    env.JSKIT_AI_ROOT = developmentRepoRoot;
    env.JSKIT_DEVLINKS = developmentRepoRoot;
    env.JSKIT_REPO_ROOT = developmentRepoRoot;
  }

  return env;
}

async function readFirstLine(filePath = "") {
  try {
    const text = await readFile(filePath, "utf8");
    return normalizeText(text.split(/\r?\n/u)[0]);
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return "";
  }
}

function configuredRepoRootFromEnv() {
  const devlinks = normalizeText(process.env.JSKIT_DEVLINKS);
  if (devlinks && isDisabledValue(devlinks)) {
    return "";
  }
  if (devlinks && !isEnabledValue(devlinks)) {
    return devlinks;
  }
  if (devlinks && isEnabledValue(devlinks) && normalizeText(process.env.JSKIT_AI_ROOT)) {
    return normalizeText(process.env.JSKIT_AI_ROOT);
  }
  return normalizeText(process.env.JSKIT_AI_ROOT) || normalizeText(process.env.JSKIT_REPO_ROOT);
}

async function configuredRepoRootFromFiles(targetRoot = "") {
  for (const relativePath of [
    ".jskit/config/devel_jskit_ai_root",
    ".jskit/config/devel_sibling_roots/jskit-ai"
  ]) {
    const configured = await readFirstLine(path.join(targetRoot, relativePath));
    if (configured) {
      return configured;
    }
  }
  return "";
}

async function linkedPackageSource(packagePath = "") {
  try {
    const stats = await lstat(packagePath);
    if (!stats.isSymbolicLink()) {
      return "";
    }
    return path.resolve(path.dirname(packagePath), await readlink(packagePath));
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return "";
  }
}

async function linkedRepoRootFromNodeModules(targetRoot = "") {
  for (const packageName of LINKED_JSKIT_PACKAGES) {
    const source = await linkedPackageSource(path.join(targetRoot, "node_modules", ...packageName.split("/")));
    const repoRoot = repoRootFromPackageSource(source);
    if (repoRoot && await isJskitRepoRoot(repoRoot)) {
      return repoRoot;
    }
  }
  return "";
}

async function isJskitRepoRoot(repoRoot = "") {
  return Boolean(
    repoRoot &&
    await pathExists(path.join(repoRoot, "packages")) &&
    await pathExists(path.join(repoRoot, "tooling"))
  );
}

async function resolveJskitDevelopmentRepoRoot({
  targetRoot = ""
} = {}) {
  const candidates = [
    configuredRepoRootFromEnv(),
    await configuredRepoRootFromFiles(targetRoot),
    await linkedRepoRootFromNodeModules(targetRoot)
  ];

  for (const candidate of candidates) {
    const repoRoot = normalizeText(candidate);
    if (!repoRoot) {
      continue;
    }
    if (await isJskitRepoRoot(repoRoot)) {
      return path.resolve(repoRoot);
    }
  }

  return "";
}

function optionalSessionPackageHookScript({
  developmentRepoRoot = "",
  scriptName = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const normalizedScriptName = normalizeText(scriptName);
  if (!normalizedScriptName) {
    return "";
  }

  const recordPath = session.sessionRoot
    ? path.join(session.sessionRoot, "hooks", packageScriptRecordName(normalizedScriptName))
    : "";
  const envPrefix = shellEnvironment(sessionHookEnvironment({
    developmentRepoRoot,
    scriptName: normalizedScriptName,
    session,
    targetRoot,
    worktreePath
  }));
  const runHookCommand = `${envPrefix} npm run ${shellQuote(normalizedScriptName)}`;
  const lines = [
    `if node -e ${shellQuote(PACKAGE_SCRIPT_EXISTS_NODE)} ${shellQuote(normalizedScriptName)}; then`,
    `  printf '[studio] Running package hook %s\\n' ${shellQuote(normalizedScriptName)}`,
    `  ${runHookCommand}`
  ];

  if (recordPath) {
    lines.push(
      `  mkdir -p ${shellQuote(path.dirname(recordPath))}`,
      `  { date -u '+%Y-%m-%dT%H:%M:%SZ'; printf '%s\\n' ${shellQuote(`${normalizedScriptName} completed.`)}; } > ${shellQuote(recordPath)}`
    );
  }

  lines.push(
    "else",
    `  printf '[studio] Package hook %s is not declared; skipping.\\n' ${shellQuote(normalizedScriptName)}`,
    "fi"
  );

  return lines.join("\n");
}

export {
  SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT,
  SESSION_PROVISION_PACKAGE_SCRIPT,
  optionalSessionPackageHookScript,
  resolveJskitDevelopmentRepoRoot
};
