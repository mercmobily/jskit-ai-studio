import {
  createDoctorRepair
} from "../../../doctorCheckItems.js";
import {
  dockerCommand,
  shellQuote
} from "../../../shellCommands.js";

const JSKIT_MYSQL_CONTAINER = "ai-studio-jskit-mysql";
const JSKIT_MYSQL_IMAGE = "mysql:8.4";
const JSKIT_MYSQL_ROOT_PASSWORD = "ai_studio_jskit_root";
const JSKIT_MYSQL_VOLUME = "ai_studio_jskit_mysql_data";
const JSKIT_MYSQL_PROBE_DATABASE = "ai_studio_jskit_probe";
const JSKIT_MYSQL_PROBE_TABLE = "capability_probe";

function packageDependencyNames(packageJson = {}) {
  const sections = [
    packageJson.dependencies,
    packageJson.devDependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies
  ];
  return new Set(sections.flatMap((section) => {
    return section && typeof section === "object" && !Array.isArray(section)
      ? Object.keys(section)
      : [];
  }));
}

async function targetWantsJskitMysql(targetRoot = "", toolkit) {
  const packageJsonResult = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  const lockJsonResult = await toolkit.readTargetJson(".jskit/lock.json", {
    targetRoot
  });
  const packageJson = packageJsonResult.ok ? packageJsonResult.value : {};
  const lockJson = lockJsonResult.ok ? lockJsonResult.value : {};
  const names = new Set([
    ...packageDependencyNames(packageJson),
    ...Object.keys(lockJson?.installedPackages || {})
  ]);
  return [...names].some((name) => name.includes("database-runtime-mysql"));
}

function mysqlCapabilitySql() {
  return [
    `CREATE DATABASE IF NOT EXISTS \`${JSKIT_MYSQL_PROBE_DATABASE}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    `CREATE TABLE IF NOT EXISTS \`${JSKIT_MYSQL_PROBE_DATABASE}\`.\`${JSKIT_MYSQL_PROBE_TABLE}\` (id INT NOT NULL PRIMARY KEY)`,
    `DROP TABLE \`${JSKIT_MYSQL_PROBE_DATABASE}\`.\`${JSKIT_MYSQL_PROBE_TABLE}\``,
    `DROP DATABASE \`${JSKIT_MYSQL_PROBE_DATABASE}\``
  ].join("; ");
}

function mysqlRepairRunArgs(maskPassword = false) {
  const password = maskPassword ? "*****" : JSKIT_MYSQL_ROOT_PASSWORD;
  return [
    "run",
    "-d",
    "--name",
    JSKIT_MYSQL_CONTAINER,
    "-e",
    `MYSQL_ROOT_PASSWORD=${password}`,
    "-v",
    `${JSKIT_MYSQL_VOLUME}:/var/lib/mysql`,
    "--health-cmd",
    `mysqladmin ping -uroot -p${password} --silent`,
    "--health-interval",
    "5s",
    "--health-timeout",
    "3s",
    "--health-retries",
    "20",
    JSKIT_MYSQL_IMAGE
  ];
}

function startJskitMysqlRepair() {
  return createDoctorRepair({
    actionId: "start-jskit-mysql",
    command: [
      dockerCommand(["volume", "create", JSKIT_MYSQL_VOLUME]),
      dockerCommand(mysqlRepairRunArgs(true)),
      `docker exec ${JSKIT_MYSQL_CONTAINER} mysqladmin ping -uroot -p***** --silent`
    ].join("\n"),
    kind: "terminal",
    label: "Start JSKIT MySQL"
  });
}

function startJskitMysqlScript() {
  return [
    "set -e",
    `MYSQL_ROOT_PASSWORD=${shellQuote(JSKIT_MYSQL_ROOT_PASSWORD)}`,
    `MYSQL_CONTAINER=${shellQuote(JSKIT_MYSQL_CONTAINER)}`,
    `echo '$ ${dockerCommand(["volume", "create", JSKIT_MYSQL_VOLUME])}'`,
    `docker volume create ${shellQuote(JSKIT_MYSQL_VOLUME)}`,
    `if ! docker inspect ${shellQuote(JSKIT_MYSQL_CONTAINER)} >/dev/null 2>&1; then`,
    `  echo '$ ${dockerCommand(mysqlRepairRunArgs(true))}'`,
    `  docker run -d --name ${shellQuote(JSKIT_MYSQL_CONTAINER)} -e MYSQL_ROOT_PASSWORD="$MYSQL_ROOT_PASSWORD" -v ${shellQuote(`${JSKIT_MYSQL_VOLUME}:/var/lib/mysql`)} --health-cmd "mysqladmin ping -uroot -p$MYSQL_ROOT_PASSWORD --silent" --health-interval 5s --health-timeout 3s --health-retries 20 ${shellQuote(JSKIT_MYSQL_IMAGE)}`,
    "else",
    `  if [ "$(docker inspect ${shellQuote(JSKIT_MYSQL_CONTAINER)} --format '{{.State.Running}}')" != "true" ]; then`,
    `    echo '$ ${dockerCommand(["start", JSKIT_MYSQL_CONTAINER])}'`,
    `    docker start ${shellQuote(JSKIT_MYSQL_CONTAINER)}`,
    "  fi",
    "fi",
    "for attempt in $(seq 1 40); do",
    `  echo '$ docker exec ${JSKIT_MYSQL_CONTAINER} mysqladmin ping -uroot -p***** --silent'`,
    `  if docker exec ${shellQuote(JSKIT_MYSQL_CONTAINER)} mysqladmin ping -uroot -p"$MYSQL_ROOT_PASSWORD" --silent; then`,
    "    exit 0",
    "  fi",
    "  sleep 1.5",
    "done",
    "echo 'Timed out waiting for JSKIT MySQL to accept connections.' >&2",
    "exit 1"
  ].join("\n");
}

function escapeMysqlIdentifier(value) {
  return String(value).replaceAll("`", "``");
}

function validateDatabaseName(value) {
  const databaseName = String(value || "").trim();
  if (!/^[A-Za-z0-9_]+$/u.test(databaseName)) {
    return {
      databaseName,
      ok: false
    };
  }
  return {
    databaseName,
    ok: true
  };
}

function createAppDatabaseDockerArgs(databaseName) {
  const escaped = escapeMysqlIdentifier(databaseName);
  return [
    "exec",
    "-it",
    JSKIT_MYSQL_CONTAINER,
    "mysql",
    "-uroot",
    `-p${JSKIT_MYSQL_ROOT_PASSWORD}`,
    "-e",
    `CREATE DATABASE IF NOT EXISTS \`${escaped}\`; SELECT SCHEMA_NAME FROM INFORMATION_SCHEMA.SCHEMATA WHERE SCHEMA_NAME = '${databaseName}';`
  ];
}

function createAppDatabaseRepair(databaseName) {
  return createDoctorRepair({
    actionId: "terminal-create-app-db",
    command: dockerCommand(createAppDatabaseDockerArgs(databaseName)),
    fields: [
      {
        defaultValue: databaseName,
        id: "databaseName",
        label: "Database name",
        required: true,
        type: "text"
      }
    ],
    label: "Create app database"
  });
}

export {
  createAppDatabaseDockerArgs,
  createAppDatabaseRepair,
  JSKIT_MYSQL_CONTAINER,
  JSKIT_MYSQL_ROOT_PASSWORD,
  mysqlCapabilitySql,
  startJskitMysqlRepair,
  startJskitMysqlScript,
  targetWantsJskitMysql,
  validateDatabaseName
};
