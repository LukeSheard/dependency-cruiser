const glob = require("glob");
const get = require("lodash/get");
const clone = require("lodash/clone");
const set = require("lodash/set");

const main = require("../main");
const bus = require("../utl/bus");

const extractTSConfig = require("../config-utl/extract-ts-config");
const extractBabelConfig = require("../config-utl/extract-babel-config");
const extractWebpackResolveConfig = require("../config-utl/extract-webpack-resolve-config");
const extractKnownViolations = require("../config-utl/extract-known-violations");
const validateFileExistence = require("./utl/validate-file-existence");
const normalizeCliOptions = require("./normalize-cli-options");
const io = require("./utl/io");
const formatMetaInfo = require("./format-meta-info");
const setUpCliFeedbackListener = require("./listeners/cli-feedback");
const setUpPerformanceLogListener = require("./listeners/performance-log");
const defaults = require("./defaults");

function extractResolveOptions(pCruiseOptions) {
  let lResolveOptions = {};
  const lWebPackConfigFileName = get(
    pCruiseOptions,
    "ruleSet.options.webpackConfig.fileName",
    null
  );

  if (lWebPackConfigFileName) {
    lResolveOptions = extractWebpackResolveConfig(
      lWebPackConfigFileName,
      get(pCruiseOptions, "ruleSet.options.webpackConfig.env", null),
      get(pCruiseOptions, "ruleSet.options.webpackConfig.arguments", null)
    );
  }
  return lResolveOptions;
}

function addKnownViolations(pCruiseOptions) {
  if (pCruiseOptions.knownViolationsFile) {
    const lKnownViolations = extractKnownViolations(
      pCruiseOptions.knownViolationsFile
    );

    // Check against json schema is already done in src/main/options/validate
    // so here we can just concentrate on the io
    let lCruiseOptions = clone(pCruiseOptions);
    set(lCruiseOptions, "ruleSet.options.knownViolations", lKnownViolations);
    return lCruiseOptions;
  }
  return pCruiseOptions;
}

function extractTSConfigOptions(pCruiseOptions) {
  let lReturnValue = {};
  const lTSConfigFileName = get(
    pCruiseOptions,
    "ruleSet.options.tsConfig.fileName",
    null
  );

  if (lTSConfigFileName) {
    lReturnValue = extractTSConfig(lTSConfigFileName);
  }

  return lReturnValue;
}

function extractBabelConfigOptions(pCruiseOptions) {
  const lBabelConfigFileName = get(
    pCruiseOptions,
    "ruleSet.options.babelConfig.fileName",
    null
  );

  const lBabelConfig = get(
    pCruiseOptions,
    "ruleSet.options.babelConfig.config",
    null
  );

  if (lBabelConfigFileName || lBabelConfig) {
    // ensure we always pass in a babel config filename even if we only have a config
    return extractBabelConfig(lBabelConfigFileName || defaults.BABEL_CONFIG, lBabelConfig);
  }

  return {};
}

function setUpListener(pCruiseOptions) {
  const lString2Listener = {
    "cli-feedback": setUpCliFeedbackListener,
    "performance-log": setUpPerformanceLogListener,
  };
  const lListenerID = get(
    pCruiseOptions,
    "progress",
    get(pCruiseOptions, "ruleSet.options.progress.type")
  );
  const lListenerFunction = get(lString2Listener, lListenerID);
  /* c8 ignore next 3 */
  if (Boolean(lListenerFunction)) {
    lListenerFunction(bus);
  }
}

function runCruise(pFileDirectoryArray, pCruiseOptions) {
  pFileDirectoryArray
    .filter((pFileOrDirectory) => !glob.hasMagic(pFileOrDirectory))
    .forEach(validateFileExistence);

  const lCruiseOptions = addKnownViolations(
    normalizeCliOptions(pCruiseOptions)
  );

  setUpListener(lCruiseOptions);

  bus.emit("start");
  const lReportingResult = main.futureCruise(
    pFileDirectoryArray,
    lCruiseOptions,
    extractResolveOptions(lCruiseOptions),
    {
      tsConfig: extractTSConfigOptions(lCruiseOptions),
      babelConfig: extractBabelConfigOptions(lCruiseOptions),
    }
  );

  bus.emit("progress", "cli: writing results");
  bus.emit("write-start");
  io.write(lCruiseOptions.outputTo, lReportingResult.output);
  bus.emit("end");

  return lReportingResult.exitCode;
}

/**
 *
 * @param {string[]} pFileDirectoryArray
 * @param {import("../../types/options").ICruiseOptions} pCruiseOptions
 * @returns {number}
 */
module.exports = function executeCli(pFileDirectoryArray, pCruiseOptions) {
  pCruiseOptions = pCruiseOptions || {};
  let lExitCode = 0;

  try {
    if (pCruiseOptions.info === true) {
      process.stdout.write(formatMetaInfo());
    } else if (pCruiseOptions.init) {
      // requiring init-config takes ~100ms (most of it taken up by requiring
      // inquirer, measured on a 2.6GHz quad core i7 with flash storage on
      // macOS 10.15.7). Only requiring it when '--init' is necessary speeds up
      // (the start-up) of cruises by that same amount.
      // eslint-disable-next-line node/global-require
      const initConfig = require("./init-config");
      initConfig(pCruiseOptions.init);
    } else {
      lExitCode = runCruise(pFileDirectoryArray, pCruiseOptions);
    }
  } catch (pError) {
    process.stderr.write(`\n  ERROR: ${pError.message}\n`);
    bus.emit("end");
    lExitCode = 1;
  }

  return lExitCode;
};
