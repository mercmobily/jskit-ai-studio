import path from "node:path";

import {
  blockedDoctorCheck as blockedCheck,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  hostUserDockerArgs
} from "../../../shellCommands.js";
import {
  shellScript
} from "../../../shellScript.js";
import {
  createAppDatabaseDockerArgs,
  createAppDatabaseRepair,
  JSKIT_MYSQL_CONTAINER,
  JSKIT_MYSQL_ROOT_PASSWORD,
  validateDatabaseName
} from "./setupMysqlRuntime.js";
import {
  configImportProblems,
  missingDirectDependencies,
  readPackageJson
} from "./setupDependencyChecks.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
}

function titleFromRepoName(repoName) {
  return repoName
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "JSKIT App";
}

function writableHostUserDockerArgs() {
  return [
    ...hostUserDockerArgs(),
    "-e",
    "HOME=/tmp/studio-home",
    "-e",
    "npm_config_cache=/tmp/npm-cache"
  ];
}

function scaffoldScript() {
  return shellScript([
    "set -e",
    "set -x",
    "npx @jskit-ai/create-app \"$JSKIT_APP_NAME\" --target . --force --tenancy-mode none --title \"$JSKIT_APP_TITLE\" --initial-bundles none"
  ]);
}

function scaffoldEnvArgs(targetRoot) {
  const repoName = repoNameFromTargetRoot(targetRoot);
  return [
    ...writableHostUserDockerArgs(),
    "-e",
    `JSKIT_APP_NAME=${repoName}`,
    "-e",
    `JSKIT_APP_TITLE=${titleFromRepoName(repoName)}`
  ];
}

function scaffoldTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-scaffold-jskit",
    commandArgs: ["bash", "-lc", scaffoldScript()],
    extraArgs: () => scaffoldEnvArgs(targetRoot),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Create JSKIT scaffold",
    targetRoot
  });
}

function scaffoldRepair(targetRoot, toolkit) {
  return scaffoldTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function npmInstallScript() {
  return shellScript([
    "set -e",
    "set -x",
    "npm install",
    "jskit_deps=$(node -e \"const p=require('./package.json'); const deps={...(p.dependencies||{}), ...(p.devDependencies||{})}; console.log(Object.keys(deps).filter((name) => name.startsWith('@jskit-ai/')).join(' '));\")",
    "if [ -n \"$jskit_deps\" ]; then npm update $jskit_deps; fi"
  ]);
}

function npmInstallTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-npm-install",
    commandArgs: ["bash", "-lc", npmInstallScript()],
    extraArgs: writableHostUserDockerArgs(),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Install dependencies",
    targetRoot
  });
}

function npmInstallRepair(targetRoot, toolkit) {
  return npmInstallTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function jskitDoctorScript() {
  return shellScript([
    "set -e",
    "set -x",
    "if node -e \"const p=require('./package.json'); process.exit(p.scripts && p.scripts.verify ? 0 : 1)\"; then npm run verify; else npx jskit app verify; fi"
  ]);
}

function jskitDoctorTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-jskit-doctor",
    commandArgs: ["bash", "-lc", jskitDoctorScript()],
    extraArgs: writableHostUserDockerArgs(),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Run JSKIT doctor",
    targetRoot
  });
}

function jskitDoctorRepair(targetRoot, toolkit) {
  return jskitDoctorTerminalAction(targetRoot, toolkit).repair({
    targetRoot
  });
}

function doctorIssueLines(output) {
  return String(output || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => /^-\s+\[[^\]]+\]/u.test(line));
}

function onlyUiVerificationDoctorIssues(output) {
  const issues = doctorIssueLines(output);
  return issues.length > 0 && issues.every((line) => /^-\s+\[ui:verification\]/u.test(line));
}

function dependencyNames(packageJson, jskitLock) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies", "optionalDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  for (const name of Object.keys(jskitLock?.installedPackages || {})) {
    names.add(name);
  }
  return names;
}

function parseEnvText(text) {
  const values = {};
  for (const line of String(text || "").split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u.exec(trimmed);
    if (!match) {
      continue;
    }
    let value = match[2].trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function readEnv(targetRoot, toolkit) {
  const env = {};
  for (const fileName of [".env", ".env.local"]) {
    const envFile = await toolkit.readTargetFile(fileName, {
      targetRoot
    });
    if (envFile.ok) {
      Object.assign(env, parseEnvText(envFile.value));
    }
  }
  return env;
}

function databaseNameFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/^\/+/u, "").split("/")[0] || "";
  } catch {
    return "";
  }
}

async function checkScaffold(targetRoot, context, toolkit) {
  const markers = {
    configPublic: await toolkit.targetConfigFileExists("public.js", { targetRoot }),
    lock: await toolkit.targetFileExists(".jskit/lock.json", { targetRoot }),
    packageJson: await toolkit.targetFileExists("package.json", { targetRoot })
  };

  if (markers.lock) {
    const lock = await toolkit.readTargetJson(".jskit/lock.json", { targetRoot });
    if (!lock.ok) {
      return hardStopCheck({
        id: "scaffold",
        label: "Initial JSKIT scaffold",
        expected: ".jskit/lock.json is valid JSON.",
        observed: lock.error,
        explanation: "Malformed JSKIT metadata needs manual recovery before Studio can reason about the app."
      });
    }
    context.jskitLock = lock.value;
  }

  if (markers.packageJson && markers.lock && markers.configPublic) {
    return passCheck({
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      expected: "package.json, .jskit/lock.json, and config/public.js exist.",
      observed: "Minimal JSKIT scaffold markers are present.",
      explanation: "Studio can now use official JSKIT tooling for deeper checks."
    });
  }

  const nonGitEntries = (context.nonGitEntries || []).filter((entry) => entry !== "node_modules");
  if (nonGitEntries.length) {
    return hardStopCheck({
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      expected: "Existing files are already a recognizable JSKIT scaffold.",
      observed: `Missing markers: ${Object.entries(markers).filter(([, present]) => !present).map(([name]) => name).join(", ")}\nFiles: ${formatList(nonGitEntries)}`,
      explanation: "Studio will not run the JSKIT app generator over an existing non-JSKIT file tree."
    });
  }

  return blockedCheck({
    id: "scaffold",
    label: "Initial JSKIT scaffold",
    expected: "Minimal JSKIT scaffold markers exist.",
    observed: "No scaffold files are present yet.",
    explanation: "Create the smallest JSKIT app scaffold before installing dependencies or running doctor.",
    repair: scaffoldRepair(targetRoot, toolkit)
  });
}

async function checkDependencies(targetRoot, context, toolkit) {
  const packageJson = await readPackageJson(targetRoot, toolkit);
  context.packageJson = packageJson;
  if (!packageJson) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "package.json exists before npm install.",
      observed: "package.json is missing.",
      explanation: "Dependencies can only be installed after the scaffold exists."
    });
  }

  const missingDependencies = await missingDirectDependencies(targetRoot, packageJson, toolkit);
  if (missingDependencies.length) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "All direct non-optional package.json dependencies are installed.",
      observed: `Missing node_modules packages:\n${formatList(missingDependencies)}`,
      explanation: "Install dependencies before running the official JSKIT doctor.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  const importProblems = await configImportProblems(targetRoot, toolkit);
  if (importProblems.length) {
    return blockedCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "Config-file package imports resolve from installed node_modules.",
      observed: formatList(importProblems, 8),
      explanation: "The target lockfile can pin stale JSKIT packages that install successfully but do not provide exports used by generated config files.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  const hasJskitBin = await toolkit.targetFileExists(path.join("node_modules", ".bin", "jskit"), { targetRoot });
  const hasJskitCli = await toolkit.targetFileExists(path.join("node_modules", "@jskit-ai", "jskit-cli"), { targetRoot });
  if (hasJskitBin || hasJskitCli) {
    return passCheck({
      id: "dependencies",
      label: "Dependencies runnable",
      expected: "JSKIT CLI dependency is installed locally.",
      observed: "node_modules contains JSKIT CLI tooling.",
      explanation: "Local JSKIT commands can run in the target app.",
      repair: npmInstallRepair(targetRoot, toolkit)
    });
  }

  return blockedCheck({
    id: "dependencies",
    label: "Dependencies runnable",
    expected: "Local dependencies are installed.",
    observed: "node_modules does not contain JSKIT CLI tooling.",
    explanation: "Install dependencies before running the official JSKIT doctor.",
    repair: npmInstallRepair(targetRoot, toolkit)
  });
}

async function checkRuntimeServices(targetRoot, context, toolkit) {
  const packageJson = context.packageJson || await readPackageJson(targetRoot, toolkit);
  const names = dependencyNames(packageJson, context.jskitLock);
  const hasDatabase = [...names].some((name) => name.includes("database-runtime"));
  const wantsMysql = [...names].some((name) => name.includes("database-runtime-mysql"));
  const wantsPostgres = [...names].some((name) => name.includes("database-runtime-postgres"));

  if (!hasDatabase) {
    return passCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "No runtime service is required unless the target app asks for one.",
      observed: "No JSKIT database runtime package detected.",
      explanation: "Fresh minimal scaffolds do not require a database."
    });
  }

  if (wantsPostgres && !wantsMysql) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "This JSKIT setup plugin supports managed MySQL checks only.",
      observed: "Postgres runtime package detected.",
      explanation: "Postgres service orchestration belongs in the JSKIT adapter before this target can be set up automatically."
    });
  }

  const env = await readEnv(targetRoot, toolkit);
  const databaseName = env.DB_NAME || databaseNameFromUrl(env.DATABASE_URL);
  const validation = validateDatabaseName(databaseName);
  if (!validation.ok) {
    return hardStopCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Database apps declare a valid DB_NAME or DATABASE_URL.",
      observed: databaseName || "No database name found in .env or .env.local.",
      explanation: "Studio cannot create or verify an app database without an explicit database name."
    });
  }

  const ping = await toolkit.runDocker([
    "exec",
    JSKIT_MYSQL_CONTAINER,
    "mysqladmin",
    "ping",
    "-uroot",
    `-p${JSKIT_MYSQL_ROOT_PASSWORD}`,
    "--silent"
  ], {
    timeout: 12_000
  });

  if (!ping.ok) {
    return blockedCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: "Managed JSKIT MySQL is reachable.",
      observed: ping.output,
      explanation: "Start the JSKIT managed MySQL runtime before database apps can proceed."
    });
  }

  const schema = await toolkit.runDocker([
    "exec",
    JSKIT_MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${JSKIT_MYSQL_ROOT_PASSWORD}`,
    "-N",
    "-B",
    "-e",
    `SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${validation.databaseName}';`
  ], {
    timeout: 15_000
  });

  if (!schema.ok || !schema.stdout.split(/\s+/u).includes(validation.databaseName)) {
    return blockedCheck({
      id: "runtime-services",
      label: "Runtime services",
      expected: `${validation.databaseName} exists in managed JSKIT MySQL.`,
      observed: schema.output || "Database not found.",
      explanation: "Create the app database before running JSKIT doctor.",
      repair: createAppDatabaseRepair(validation.databaseName)
    });
  }

  if (env.DB_USER) {
    const appLogin = await toolkit.runDocker([
      "exec",
      JSKIT_MYSQL_CONTAINER,
      "mysql",
      `-u${env.DB_USER}`,
      env.DB_PASSWORD ? `-p${env.DB_PASSWORD}` : "",
      validation.databaseName,
      "-e",
      "SELECT 1;"
    ].filter(Boolean), {
      timeout: 15_000
    });

    if (!appLogin.ok) {
      return hardStopCheck({
        id: "runtime-services",
        label: "Runtime services",
        expected: "Configured DB_USER can connect to the app database.",
        observed: appLogin.output,
        explanation: "Fix database credentials or grants manually before Studio continues."
      });
    }
  }

  return passCheck({
    id: "runtime-services",
    label: "Runtime services",
    expected: "Required runtime services are reachable.",
    observed: env.DB_USER
      ? `${validation.databaseName} exists and ${env.DB_USER} can connect.`
      : `${validation.databaseName} exists in managed JSKIT MySQL.`,
    explanation: "The target app's database dependency has a reachable database."
  });
}

async function checkJskitDoctor(targetRoot, toolkit) {
  const result = await toolkit.runToolchain(["bash", "-lc", jskitDoctorScript()], {
    extraArgs: writableHostUserDockerArgs(),
    image: JSKIT_TOOLCHAIN_IMAGE,
    targetRoot,
    timeout: 180_000
  });

  if (!result.ok) {
    if (onlyUiVerificationDoctorIssues(result.output)) {
      return passCheck({
        id: "jskit-doctor",
        label: "JSKIT doctor",
        expected: "Official JSKIT verification passes, or only the fresh scaffold UI receipt gate remains before the setup checkpoint.",
        observed: [
          "JSKIT doctor reported only UI verification receipt issue(s).",
          formatList(doctorIssueLines(result.output), 4)
        ].join("\n"),
        explanation: "Fresh scaffold UI files are the setup baseline, not Studio feature work yet. App Setup continues to the Git checkpoint so later UI changes still require real verification receipts."
      });
    }

    return blockedCheck({
      id: "jskit-doctor",
      label: "JSKIT doctor",
      expected: "Official JSKIT verification passes.",
      observed: result.output.split(/\r?\n/u).slice(-24).join("\n"),
      explanation: "Studio does not duplicate JSKIT internals; fix the reported doctor issues and refresh.",
      repair: jskitDoctorRepair(targetRoot, toolkit)
    });
  }

  return passCheck({
    id: "jskit-doctor",
    label: "JSKIT doctor",
    expected: "Official JSKIT verification passes.",
    observed: result.output.split(/\r?\n/u).slice(-12).join("\n") || "Verification passed.",
    explanation: "The target app passes the authoritative JSKIT readiness check."
  });
}

function createJskitTargetSetupChecks(toolkit) {
  return {
    dependencies: {
      expected: "Node dependencies are installed enough to run JSKIT commands.",
      id: "dependencies",
      label: "Dependencies runnable",
      run: (context = {}) => checkDependencies(context.targetRoot || "", context, toolkit)
    },
    doctor: {
      expected: "The official JSKIT verification command passes.",
      id: "jskit-doctor",
      label: "JSKIT doctor",
      run: ({ targetRoot = "" } = {}) => checkJskitDoctor(targetRoot, toolkit)
    },
    runtimeServices: {
      expected: "Only runtime services required by the target app are reachable.",
      id: "runtime-services",
      label: "Runtime services",
      run: (context = {}) => checkRuntimeServices(context.targetRoot || "", context, toolkit)
    },
    scaffold: {
      expected: "Minimal JSKIT scaffold markers exist.",
      id: "scaffold",
      label: "Initial JSKIT scaffold",
      run: (context = {}) => checkScaffold(context.targetRoot || "", context, toolkit)
    }
  };
}

function createDatabaseTerminalAction(targetRoot, toolkit) {
  return toolkit.dockerTerminalAction({
    actionId: "terminal-create-app-db",
    args: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return createAppDatabaseDockerArgs(validation.databaseName);
    },
    commandPreview: ({ input = {} } = {}) => {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok
        ? createAppDatabaseRepair(validation.databaseName).commandPreview
        : "docker exec <mysql-container> mysql -e <create database>";
    },
    cwd: targetRoot,
    label: "Create app database",
    validate({ input = {} } = {}) {
      const validation = validateDatabaseName(input.databaseName);
      return validation.ok ? null : "A valid databaseName input is required.";
    }
  });
}

function createJskitTargetSetupTerminalActions({
  targetRoot = "",
  toolkit = null
} = {}) {
  if (!toolkit) {
    return [];
  }

  return [
    scaffoldTerminalAction(targetRoot, toolkit),
    npmInstallTerminalAction(targetRoot, toolkit),
    createDatabaseTerminalAction(targetRoot, toolkit),
    jskitDoctorTerminalAction(targetRoot, toolkit)
  ];
}

export {
  createJskitTargetSetupChecks,
  createJskitTargetSetupTerminalActions,
  doctorIssueLines,
  jskitDoctorScript,
  npmInstallScript,
  onlyUiVerificationDoctorIssues
};
