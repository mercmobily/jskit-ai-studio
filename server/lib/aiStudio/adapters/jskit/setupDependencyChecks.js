import path from "node:path";

const CONFIG_IMPORT_FILES = [
  "eslint.config.mjs",
  "playwright.config.mjs",
  "vite.config.mjs",
  "vitest.config.mjs"
];

async function readPackageJson(targetRoot, toolkit) {
  const result = await toolkit.readTargetJson("package.json", {
    targetRoot
  });
  return result.ok ? result.value : null;
}

function directDependencyNames(packageJson) {
  const names = new Set();
  for (const bucket of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(packageJson?.[bucket] || {})) {
      names.add(name);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

function nodeModulePackageJsonPath(targetRoot, packageName) {
  return path.join(targetRoot, "node_modules", ...String(packageName || "").split("/"), "package.json");
}

async function missingDirectDependencies(targetRoot, packageJson, toolkit) {
  const missing = [];
  for (const packageName of directDependencyNames(packageJson)) {
    if (!await toolkit.fileExists(nodeModulePackageJsonPath(targetRoot, packageName))) {
      missing.push(packageName);
    }
  }
  return missing;
}

function packageSpecifierInfo(specifier) {
  const normalized = String(specifier || "").trim();
  if (!normalized || normalized.startsWith(".") || normalized.startsWith("/") || normalized.startsWith("node:")) {
    return null;
  }

  const parts = normalized.split("/");
  if (normalized.startsWith("@")) {
    if (parts.length < 2) {
      return null;
    }
    return {
      packageName: parts.slice(0, 2).join("/"),
      subpath: parts.slice(2).join("/")
    };
  }

  return {
    packageName: parts[0],
    subpath: parts.slice(1).join("/")
  };
}

function configImportSpecifiersFromText(text) {
  const specifiers = new Set();
  const importPattern = /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s+["']([^"']+)["']/gmu;
  for (const match of String(text || "").matchAll(importPattern)) {
    const specifier = match[1] || match[2] || match[3] || "";
    if (packageSpecifierInfo(specifier)) {
      specifiers.add(specifier);
    }
  }
  return [...specifiers].sort((left, right) => left.localeCompare(right));
}

function exportMapHasSubpath(exportsMap, subpathKey) {
  if (!exportsMap) {
    return false;
  }
  if (typeof exportsMap === "string" || Array.isArray(exportsMap)) {
    return subpathKey === ".";
  }
  if (typeof exportsMap !== "object") {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(exportsMap, subpathKey)) {
    return true;
  }
  for (const key of Object.keys(exportsMap)) {
    if (!key.includes("*")) {
      continue;
    }
    const [prefix, suffix] = key.split("*");
    if (subpathKey.startsWith(prefix) && subpathKey.endsWith(suffix || "")) {
      return true;
    }
  }
  return false;
}

async function packageSubpathExistsWithoutExportsMap(packageRoot, subpath, toolkit) {
  const basePath = path.join(packageRoot, ...subpath.split("/"));
  for (const candidate of [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs"),
    path.join(basePath, "index.cjs")
  ]) {
    if (await toolkit.fileExists(candidate)) {
      return true;
    }
  }
  return false;
}

async function configImportProblems(targetRoot, toolkit) {
  const problems = [];
  for (const fileName of CONFIG_IMPORT_FILES) {
    const configFile = await toolkit.readTargetFile(fileName, {
      targetRoot
    });
    if (!configFile.ok) {
      continue;
    }

    for (const specifier of configImportSpecifiersFromText(configFile.value)) {
      const info = packageSpecifierInfo(specifier);
      if (!info?.subpath) {
        continue;
      }

      const packageRoot = path.join(targetRoot, "node_modules", ...info.packageName.split("/"));
      const packageJson = await toolkit.readJsonFile(path.join(packageRoot, "package.json"));
      if (!packageJson.ok) {
        problems.push(`${fileName}: ${specifier} package metadata is missing.`);
        continue;
      }

      const subpathKey = `./${info.subpath}`;
      if (packageJson.value.exports) {
        if (!exportMapHasSubpath(packageJson.value.exports, subpathKey)) {
          problems.push(`${fileName}: ${specifier} is not exported by ${info.packageName}@${packageJson.value.version || "unknown"} (${subpathKey}).`);
        }
        continue;
      }

      if (!await packageSubpathExistsWithoutExportsMap(packageRoot, info.subpath, toolkit)) {
        problems.push(`${fileName}: ${specifier} is not present in ${info.packageName}@${packageJson.value.version || "unknown"}.`);
      }
    }
  }
  return problems.sort((left, right) => left.localeCompare(right));
}

export {
  configImportProblems,
  configImportSpecifiersFromText,
  directDependencyNames,
  missingDirectDependencies,
  readPackageJson
};
