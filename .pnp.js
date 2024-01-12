#!/usr/bin/env node

/* eslint-disable max-len, flowtype/require-valid-file-annotation, flowtype/require-return-type */
/* global packageInformationStores, null, $$SETUP_STATIC_TABLES */

// Used for the resolveUnqualified part of the resolution (ie resolving folder/index.js & file extensions)
// Deconstructed so that they aren't affected by any fs monkeypatching occuring later during the execution
const {statSync, lstatSync, readlinkSync, readFileSync, existsSync, realpathSync} = require('fs');

const Module = require('module');
const path = require('path');
const StringDecoder = require('string_decoder');

const ignorePattern = null ? new RegExp(null) : null;

const pnpFile = path.resolve(__dirname, __filename);
const builtinModules = new Set(Module.builtinModules || Object.keys(process.binding('natives')));

const topLevelLocator = {name: null, reference: null};
const blacklistedLocator = {name: NaN, reference: NaN};

// Used for compatibility purposes - cf setupCompatibilityLayer
const patchedModules = [];
const fallbackLocators = [topLevelLocator];

// Matches backslashes of Windows paths
const backwardSlashRegExp = /\\/g;

// Matches if the path must point to a directory (ie ends with /)
const isDirRegExp = /\/$/;

// Matches if the path starts with a valid path qualifier (./, ../, /)
// eslint-disable-next-line no-unused-vars
const isStrictRegExp = /^\.{0,2}\//;

// Splits a require request into its components, or return null if the request is a file path
const pathRegExp = /^(?![a-zA-Z]:[\\\/]|\\\\|\.{0,2}(?:\/|$))((?:@[^\/]+\/)?[^\/]+)\/?(.*|)$/;

// Keep a reference around ("module" is a common name in this context, so better rename it to something more significant)
const pnpModule = module;

/**
 * Used to disable the resolution hooks (for when we want to fallback to the previous resolution - we then need
 * a way to "reset" the environment temporarily)
 */

let enableNativeHooks = true;

/**
 * Simple helper function that assign an error code to an error, so that it can more easily be caught and used
 * by third-parties.
 */

function makeError(code, message, data = {}) {
  const error = new Error(message);
  return Object.assign(error, {code, data});
}

/**
 * Ensures that the returned locator isn't a blacklisted one.
 *
 * Blacklisted packages are packages that cannot be used because their dependencies cannot be deduced. This only
 * happens with peer dependencies, which effectively have different sets of dependencies depending on their parents.
 *
 * In order to deambiguate those different sets of dependencies, the Yarn implementation of PnP will generate a
 * symlink for each combination of <package name>/<package version>/<dependent package> it will find, and will
 * blacklist the target of those symlinks. By doing this, we ensure that files loaded through a specific path
 * will always have the same set of dependencies, provided the symlinks are correctly preserved.
 *
 * Unfortunately, some tools do not preserve them, and when it happens PnP isn't able anymore to deduce the set of
 * dependencies based on the path of the file that makes the require calls. But since we've blacklisted those paths,
 * we're able to print a more helpful error message that points out that a third-party package is doing something
 * incompatible!
 */

// eslint-disable-next-line no-unused-vars
function blacklistCheck(locator) {
  if (locator === blacklistedLocator) {
    throw makeError(
      `BLACKLISTED`,
      [
        `A package has been resolved through a blacklisted path - this is usually caused by one of your tools calling`,
        `"realpath" on the return value of "require.resolve". Since the returned values use symlinks to disambiguate`,
        `peer dependencies, they must be passed untransformed to "require".`,
      ].join(` `)
    );
  }

  return locator;
}

let packageInformationStores = new Map([
  ["@types/vscode", new Map([
    ["1.85.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-vscode-1.85.0-46beb07f0f626665b52d1e2294382b2bc63b602e-integrity/node_modules/@types/vscode/"),
      packageDependencies: new Map([
        ["@types/vscode", "1.85.0"],
      ]),
    }],
  ])],
  ["@types/mocha", new Map([
    ["10.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-mocha-10.0.6-818551d39113081048bdddbef96701b4e8bb9d1b-integrity/node_modules/@types/mocha/"),
      packageDependencies: new Map([
        ["@types/mocha", "10.0.6"],
      ]),
    }],
  ])],
  ["@types/node", new Map([
    ["18.19.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-node-18.19.6-537beece2c8ad4d9abdaa3b0f428e601eb57dac8-integrity/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["undici-types", "5.26.5"],
        ["@types/node", "18.19.6"],
      ]),
    }],
    ["20.11.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-node-20.11.0-8e0b99e70c0c1ade1a86c4a282f7b7ef87c9552f-integrity/node_modules/@types/node/"),
      packageDependencies: new Map([
        ["undici-types", "5.26.5"],
        ["@types/node", "20.11.0"],
      ]),
    }],
  ])],
  ["undici-types", new Map([
    ["5.26.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-undici-types-5.26.5-bcd539893d00b56e964fd2657a4866b221a65617-integrity/node_modules/undici-types/"),
      packageDependencies: new Map([
        ["undici-types", "5.26.5"],
      ]),
    }],
  ])],
  ["@typescript-eslint/eslint-plugin", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-eslint-plugin-6.18.1-0df881a47da1c1a9774f39495f5f7052f86b72e0-integrity/node_modules/@typescript-eslint/eslint-plugin/"),
      packageDependencies: new Map([
        ["@typescript-eslint/parser", "6.18.1"],
        ["eslint", "8.56.0"],
        ["@eslint-community/regexpp", "4.10.0"],
        ["@typescript-eslint/scope-manager", "6.18.1"],
        ["@typescript-eslint/type-utils", "6.18.1"],
        ["@typescript-eslint/utils", "pnp:3851833313f298925628c478ff14362db2969afa"],
        ["@typescript-eslint/visitor-keys", "6.18.1"],
        ["debug", "4.3.4"],
        ["graphemer", "1.4.0"],
        ["ignore", "5.3.0"],
        ["natural-compare", "1.4.0"],
        ["semver", "7.5.4"],
        ["ts-api-utils", "pnp:fce83a8e30ba70dd02ed63cd29dfa147c906a9d0"],
        ["@typescript-eslint/eslint-plugin", "6.18.1"],
      ]),
    }],
  ])],
  ["@eslint-community/regexpp", new Map([
    ["4.10.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-community-regexpp-4.10.0-548f6de556857c8bb73bbee70c35dc82a2e74d63-integrity/node_modules/@eslint-community/regexpp/"),
      packageDependencies: new Map([
        ["@eslint-community/regexpp", "4.10.0"],
      ]),
    }],
  ])],
  ["@typescript-eslint/scope-manager", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-scope-manager-6.18.1-28c31c60f6e5827996aa3560a538693cb4bd3848-integrity/node_modules/@typescript-eslint/scope-manager/"),
      packageDependencies: new Map([
        ["@typescript-eslint/types", "6.18.1"],
        ["@typescript-eslint/visitor-keys", "6.18.1"],
        ["@typescript-eslint/scope-manager", "6.18.1"],
      ]),
    }],
  ])],
  ["@typescript-eslint/types", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-types-6.18.1-91617d8080bcd99ac355d9157079970d1d49fefc-integrity/node_modules/@typescript-eslint/types/"),
      packageDependencies: new Map([
        ["@typescript-eslint/types", "6.18.1"],
      ]),
    }],
  ])],
  ["@typescript-eslint/visitor-keys", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-visitor-keys-6.18.1-704d789bda2565a15475e7d22f145b8fe77443f4-integrity/node_modules/@typescript-eslint/visitor-keys/"),
      packageDependencies: new Map([
        ["@typescript-eslint/types", "6.18.1"],
        ["eslint-visitor-keys", "3.4.3"],
        ["@typescript-eslint/visitor-keys", "6.18.1"],
      ]),
    }],
  ])],
  ["eslint-visitor-keys", new Map([
    ["3.4.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-visitor-keys-3.4.3-0cd72fe8550e3c2eae156a96a4dddcd1c8ac5800-integrity/node_modules/eslint-visitor-keys/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "3.4.3"],
      ]),
    }],
  ])],
  ["@typescript-eslint/type-utils", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-type-utils-6.18.1-115cf535f8b39db8301677199ce51151e2daee96-integrity/node_modules/@typescript-eslint/type-utils/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["@typescript-eslint/typescript-estree", "6.18.1"],
        ["@typescript-eslint/utils", "pnp:e78b389baa7bb97685bfb09f59e5816508cb0477"],
        ["debug", "4.3.4"],
        ["ts-api-utils", "pnp:f90bd8b9970dccc3377f1e25e890ae13f86f6648"],
        ["@typescript-eslint/type-utils", "6.18.1"],
      ]),
    }],
  ])],
  ["@typescript-eslint/typescript-estree", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-typescript-estree-6.18.1-a12b6440175b4cbc9d09ab3c4966c6b245215ab4-integrity/node_modules/@typescript-eslint/typescript-estree/"),
      packageDependencies: new Map([
        ["@typescript-eslint/types", "6.18.1"],
        ["@typescript-eslint/visitor-keys", "6.18.1"],
        ["debug", "4.3.4"],
        ["globby", "11.1.0"],
        ["is-glob", "4.0.3"],
        ["minimatch", "9.0.3"],
        ["semver", "7.5.4"],
        ["ts-api-utils", "pnp:08204628e14a1729bd7126b0f35259578570767a"],
        ["@typescript-eslint/typescript-estree", "6.18.1"],
      ]),
    }],
  ])],
  ["debug", new Map([
    ["4.3.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-debug-4.3.4-1319f6579357f2338d3337d2cdd4914bb5dcc865-integrity/node_modules/debug/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
        ["debug", "4.3.4"],
      ]),
    }],
  ])],
  ["ms", new Map([
    ["2.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.2"],
      ]),
    }],
    ["2.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ms-2.1.3-574c8138ce1d2b5861f0b44579dbadd60c6615b2-integrity/node_modules/ms/"),
      packageDependencies: new Map([
        ["ms", "2.1.3"],
      ]),
    }],
  ])],
  ["globby", new Map([
    ["11.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-globby-11.1.0-bd4be98bb042f83d796f7e3811991fbe82a0d34b-integrity/node_modules/globby/"),
      packageDependencies: new Map([
        ["array-union", "2.1.0"],
        ["dir-glob", "3.0.1"],
        ["fast-glob", "3.3.2"],
        ["ignore", "5.3.0"],
        ["merge2", "1.4.1"],
        ["slash", "3.0.0"],
        ["globby", "11.1.0"],
      ]),
    }],
  ])],
  ["array-union", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-array-union-2.1.0-b798420adbeb1de828d84acd8a2e23d3efe85e8d-integrity/node_modules/array-union/"),
      packageDependencies: new Map([
        ["array-union", "2.1.0"],
      ]),
    }],
  ])],
  ["dir-glob", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-dir-glob-3.0.1-56dbf73d992a4a93ba1584f4534063fd2e41717f-integrity/node_modules/dir-glob/"),
      packageDependencies: new Map([
        ["path-type", "4.0.0"],
        ["dir-glob", "3.0.1"],
      ]),
    }],
  ])],
  ["path-type", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-type-4.0.0-84ed01c0a7ba380afe09d90a8c180dcd9d03043b-integrity/node_modules/path-type/"),
      packageDependencies: new Map([
        ["path-type", "4.0.0"],
      ]),
    }],
  ])],
  ["fast-glob", new Map([
    ["3.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-glob-3.3.2-a904501e57cfdd2ffcded45e99a54fef55e46129-integrity/node_modules/fast-glob/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
        ["@nodelib/fs.walk", "1.2.8"],
        ["glob-parent", "5.1.2"],
        ["merge2", "1.4.1"],
        ["micromatch", "4.0.5"],
        ["fast-glob", "3.3.2"],
      ]),
    }],
  ])],
  ["@nodelib/fs.stat", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-stat-2.0.5-5bd262af94e9d25bd1e71b05deed44876a222e8b-integrity/node_modules/@nodelib/fs.stat/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
      ]),
    }],
  ])],
  ["@nodelib/fs.walk", new Map([
    ["1.2.8", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-walk-1.2.8-e95737e8bb6746ddedf69c556953494f196fe69a-integrity/node_modules/@nodelib/fs.walk/"),
      packageDependencies: new Map([
        ["@nodelib/fs.scandir", "2.1.5"],
        ["fastq", "1.16.0"],
        ["@nodelib/fs.walk", "1.2.8"],
      ]),
    }],
  ])],
  ["@nodelib/fs.scandir", new Map([
    ["2.1.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-scandir-2.1.5-7619c2eb21b25483f6d167548b4cfd5a7488c3d5-integrity/node_modules/@nodelib/fs.scandir/"),
      packageDependencies: new Map([
        ["@nodelib/fs.stat", "2.0.5"],
        ["run-parallel", "1.2.0"],
        ["@nodelib/fs.scandir", "2.1.5"],
      ]),
    }],
  ])],
  ["run-parallel", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-run-parallel-1.2.0-66d1368da7bdf921eb9d95bd1a9229e7f21a43ee-integrity/node_modules/run-parallel/"),
      packageDependencies: new Map([
        ["queue-microtask", "1.2.3"],
        ["run-parallel", "1.2.0"],
      ]),
    }],
  ])],
  ["queue-microtask", new Map([
    ["1.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-queue-microtask-1.2.3-4929228bbc724dfac43e0efb058caf7b6cfb6243-integrity/node_modules/queue-microtask/"),
      packageDependencies: new Map([
        ["queue-microtask", "1.2.3"],
      ]),
    }],
  ])],
  ["fastq", new Map([
    ["1.16.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fastq-1.16.0-83b9a9375692db77a822df081edb6a9cf6839320-integrity/node_modules/fastq/"),
      packageDependencies: new Map([
        ["reusify", "1.0.4"],
        ["fastq", "1.16.0"],
      ]),
    }],
  ])],
  ["reusify", new Map([
    ["1.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-reusify-1.0.4-90da382b1e126efc02146e90845a88db12925d76-integrity/node_modules/reusify/"),
      packageDependencies: new Map([
        ["reusify", "1.0.4"],
      ]),
    }],
  ])],
  ["glob-parent", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.2-869832c58034fe68a4093c17dc15e8340d8401c4-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.3"],
        ["glob-parent", "5.1.2"],
      ]),
    }],
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-parent-6.0.2-6d237d99083950c79290f24c7642a3de9a28f9e3-integrity/node_modules/glob-parent/"),
      packageDependencies: new Map([
        ["is-glob", "4.0.3"],
        ["glob-parent", "6.0.2"],
      ]),
    }],
  ])],
  ["is-glob", new Map([
    ["4.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.3-64f61e42cbbb2eec2071a9dac0b28ba1e65d5084-integrity/node_modules/is-glob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
        ["is-glob", "4.0.3"],
      ]),
    }],
  ])],
  ["is-extglob", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/"),
      packageDependencies: new Map([
        ["is-extglob", "2.1.1"],
      ]),
    }],
  ])],
  ["merge2", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-merge2-1.4.1-4368892f885e907455a6fd7dc55c0c9d404990ae-integrity/node_modules/merge2/"),
      packageDependencies: new Map([
        ["merge2", "1.4.1"],
      ]),
    }],
  ])],
  ["micromatch", new Map([
    ["4.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.5-bc8999a7cbbf77cdc89f132f6e467051b49090c6-integrity/node_modules/micromatch/"),
      packageDependencies: new Map([
        ["braces", "3.0.2"],
        ["picomatch", "2.3.1"],
        ["micromatch", "4.0.5"],
      ]),
    }],
  ])],
  ["braces", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/"),
      packageDependencies: new Map([
        ["fill-range", "7.0.1"],
        ["braces", "3.0.2"],
      ]),
    }],
  ])],
  ["fill-range", new Map([
    ["7.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/"),
      packageDependencies: new Map([
        ["to-regex-range", "5.0.1"],
        ["fill-range", "7.0.1"],
      ]),
    }],
  ])],
  ["to-regex-range", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
        ["to-regex-range", "5.0.1"],
      ]),
    }],
  ])],
  ["is-number", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/"),
      packageDependencies: new Map([
        ["is-number", "7.0.0"],
      ]),
    }],
  ])],
  ["picomatch", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-picomatch-2.3.1-3ba3833733646d9d3e4995946c1365a67fb07a42-integrity/node_modules/picomatch/"),
      packageDependencies: new Map([
        ["picomatch", "2.3.1"],
      ]),
    }],
  ])],
  ["ignore", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ignore-5.3.0-67418ae40d34d6999c95ff56016759c718c82f78-integrity/node_modules/ignore/"),
      packageDependencies: new Map([
        ["ignore", "5.3.0"],
      ]),
    }],
  ])],
  ["slash", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634-integrity/node_modules/slash/"),
      packageDependencies: new Map([
        ["slash", "3.0.0"],
      ]),
    }],
  ])],
  ["minimatch", new Map([
    ["9.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-9.0.3-a6e00c3de44c3a542bfaae70abfc22420a6da825-integrity/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "2.0.1"],
        ["minimatch", "9.0.3"],
      ]),
    }],
    ["3.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-3.1.2-19cd194bfd3e428f049a70817c038d89ab4be35b-integrity/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "1.1.11"],
        ["minimatch", "3.1.2"],
      ]),
    }],
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-5.0.1-fb9022f7528125187c92bd9e9b6366be1cf3415b-integrity/node_modules/minimatch/"),
      packageDependencies: new Map([
        ["brace-expansion", "2.0.1"],
        ["minimatch", "5.0.1"],
      ]),
    }],
  ])],
  ["brace-expansion", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-brace-expansion-2.0.1-1edc459e0f0c548486ecf9fc99f2221364b9a0ae-integrity/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.2"],
        ["brace-expansion", "2.0.1"],
      ]),
    }],
    ["1.1.11", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.2"],
        ["concat-map", "0.0.1"],
        ["brace-expansion", "1.1.11"],
      ]),
    }],
  ])],
  ["balanced-match", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-balanced-match-1.0.2-e83e3a7e3f300b34cb9d87f615fa0cbf357690ee-integrity/node_modules/balanced-match/"),
      packageDependencies: new Map([
        ["balanced-match", "1.0.2"],
      ]),
    }],
  ])],
  ["semver", new Map([
    ["7.5.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-semver-7.5.4-483986ec4ed38e1c6c48c34894a9182dbff68a6e-integrity/node_modules/semver/"),
      packageDependencies: new Map([
        ["lru-cache", "6.0.0"],
        ["semver", "7.5.4"],
      ]),
    }],
  ])],
  ["lru-cache", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lru-cache-6.0.0-6d6fe6570ebd96aaf90fcad1dafa3b2566db3a94-integrity/node_modules/lru-cache/"),
      packageDependencies: new Map([
        ["yallist", "4.0.0"],
        ["lru-cache", "6.0.0"],
      ]),
    }],
    ["10.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lru-cache-10.1.0-2098d41c2dc56500e6c88584aa656c84de7d0484-integrity/node_modules/lru-cache/"),
      packageDependencies: new Map([
        ["lru-cache", "10.1.0"],
      ]),
    }],
  ])],
  ["yallist", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yallist-4.0.0-9bb92790d9c0effec63be73519e11a35019a3a72-integrity/node_modules/yallist/"),
      packageDependencies: new Map([
        ["yallist", "4.0.0"],
      ]),
    }],
  ])],
  ["ts-api-utils", new Map([
    ["pnp:08204628e14a1729bd7126b0f35259578570767a", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-08204628e14a1729bd7126b0f35259578570767a/node_modules/ts-api-utils/"),
      packageDependencies: new Map([
        ["ts-api-utils", "pnp:08204628e14a1729bd7126b0f35259578570767a"],
      ]),
    }],
    ["pnp:f90bd8b9970dccc3377f1e25e890ae13f86f6648", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-f90bd8b9970dccc3377f1e25e890ae13f86f6648/node_modules/ts-api-utils/"),
      packageDependencies: new Map([
        ["ts-api-utils", "pnp:f90bd8b9970dccc3377f1e25e890ae13f86f6648"],
      ]),
    }],
    ["pnp:fce83a8e30ba70dd02ed63cd29dfa147c906a9d0", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-fce83a8e30ba70dd02ed63cd29dfa147c906a9d0/node_modules/ts-api-utils/"),
      packageDependencies: new Map([
        ["ts-api-utils", "pnp:fce83a8e30ba70dd02ed63cd29dfa147c906a9d0"],
      ]),
    }],
  ])],
  ["@typescript-eslint/utils", new Map([
    ["pnp:e78b389baa7bb97685bfb09f59e5816508cb0477", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-e78b389baa7bb97685bfb09f59e5816508cb0477/node_modules/@typescript-eslint/utils/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["@eslint-community/eslint-utils", "pnp:80f148d45a63cebd125171d989cc241a69688d73"],
        ["@types/json-schema", "7.0.15"],
        ["@types/semver", "7.5.6"],
        ["@typescript-eslint/scope-manager", "6.18.1"],
        ["@typescript-eslint/types", "6.18.1"],
        ["@typescript-eslint/typescript-estree", "6.18.1"],
        ["semver", "7.5.4"],
        ["@typescript-eslint/utils", "pnp:e78b389baa7bb97685bfb09f59e5816508cb0477"],
      ]),
    }],
    ["pnp:3851833313f298925628c478ff14362db2969afa", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-3851833313f298925628c478ff14362db2969afa/node_modules/@typescript-eslint/utils/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["@eslint-community/eslint-utils", "pnp:875c92d0e85d32aa44c189c39f594b09874ba086"],
        ["@types/json-schema", "7.0.15"],
        ["@types/semver", "7.5.6"],
        ["@typescript-eslint/scope-manager", "6.18.1"],
        ["@typescript-eslint/types", "6.18.1"],
        ["@typescript-eslint/typescript-estree", "6.18.1"],
        ["semver", "7.5.4"],
        ["@typescript-eslint/utils", "pnp:3851833313f298925628c478ff14362db2969afa"],
      ]),
    }],
  ])],
  ["@eslint-community/eslint-utils", new Map([
    ["pnp:80f148d45a63cebd125171d989cc241a69688d73", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-80f148d45a63cebd125171d989cc241a69688d73/node_modules/@eslint-community/eslint-utils/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["eslint-visitor-keys", "3.4.3"],
        ["@eslint-community/eslint-utils", "pnp:80f148d45a63cebd125171d989cc241a69688d73"],
      ]),
    }],
    ["pnp:875c92d0e85d32aa44c189c39f594b09874ba086", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-875c92d0e85d32aa44c189c39f594b09874ba086/node_modules/@eslint-community/eslint-utils/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["eslint-visitor-keys", "3.4.3"],
        ["@eslint-community/eslint-utils", "pnp:875c92d0e85d32aa44c189c39f594b09874ba086"],
      ]),
    }],
    ["pnp:28dd33d556be69170756af69e72c88a7b9602f0a", {
      packageLocation: path.resolve(__dirname, "./.pnp/externals/pnp-28dd33d556be69170756af69e72c88a7b9602f0a/node_modules/@eslint-community/eslint-utils/"),
      packageDependencies: new Map([
        ["eslint-visitor-keys", "3.4.3"],
        ["@eslint-community/eslint-utils", "pnp:28dd33d556be69170756af69e72c88a7b9602f0a"],
      ]),
    }],
  ])],
  ["@types/json-schema", new Map([
    ["7.0.15", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-json-schema-7.0.15-596a1747233694d50f6ad8a7869fcb6f56cf5841-integrity/node_modules/@types/json-schema/"),
      packageDependencies: new Map([
        ["@types/json-schema", "7.0.15"],
      ]),
    }],
  ])],
  ["@types/semver", new Map([
    ["7.5.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-semver-7.5.6-c65b2bfce1bec346582c07724e3f8c1017a20339-integrity/node_modules/@types/semver/"),
      packageDependencies: new Map([
        ["@types/semver", "7.5.6"],
      ]),
    }],
  ])],
  ["graphemer", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-graphemer-1.4.0-fb2f1d55e0e3a1849aeffc90c4fa0dd53a0e66c6-integrity/node_modules/graphemer/"),
      packageDependencies: new Map([
        ["graphemer", "1.4.0"],
      ]),
    }],
  ])],
  ["natural-compare", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7-integrity/node_modules/natural-compare/"),
      packageDependencies: new Map([
        ["natural-compare", "1.4.0"],
      ]),
    }],
  ])],
  ["@typescript-eslint/parser", new Map([
    ["6.18.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-parser-6.18.1-3c3987e186b38c77b30b6bfa5edf7c98ae2ec9d3-integrity/node_modules/@typescript-eslint/parser/"),
      packageDependencies: new Map([
        ["eslint", "8.56.0"],
        ["@typescript-eslint/scope-manager", "6.18.1"],
        ["@typescript-eslint/types", "6.18.1"],
        ["@typescript-eslint/typescript-estree", "6.18.1"],
        ["@typescript-eslint/visitor-keys", "6.18.1"],
        ["debug", "4.3.4"],
        ["@typescript-eslint/parser", "6.18.1"],
      ]),
    }],
  ])],
  ["eslint", new Map([
    ["8.56.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-8.56.0-4957ce8da409dc0809f99ab07a1b94832ab74b15-integrity/node_modules/eslint/"),
      packageDependencies: new Map([
        ["@eslint-community/eslint-utils", "pnp:28dd33d556be69170756af69e72c88a7b9602f0a"],
        ["@eslint-community/regexpp", "4.10.0"],
        ["@eslint/eslintrc", "2.1.4"],
        ["@eslint/js", "8.56.0"],
        ["@humanwhocodes/config-array", "0.11.14"],
        ["@humanwhocodes/module-importer", "1.0.1"],
        ["@nodelib/fs.walk", "1.2.8"],
        ["@ungap/structured-clone", "1.2.0"],
        ["ajv", "6.12.6"],
        ["chalk", "4.1.2"],
        ["cross-spawn", "7.0.3"],
        ["debug", "4.3.4"],
        ["doctrine", "3.0.0"],
        ["escape-string-regexp", "4.0.0"],
        ["eslint-scope", "7.2.2"],
        ["eslint-visitor-keys", "3.4.3"],
        ["espree", "9.6.1"],
        ["esquery", "1.5.0"],
        ["esutils", "2.0.3"],
        ["fast-deep-equal", "3.1.3"],
        ["file-entry-cache", "6.0.1"],
        ["find-up", "5.0.0"],
        ["glob-parent", "6.0.2"],
        ["globals", "13.24.0"],
        ["graphemer", "1.4.0"],
        ["ignore", "5.3.0"],
        ["imurmurhash", "0.1.4"],
        ["is-glob", "4.0.3"],
        ["is-path-inside", "3.0.3"],
        ["js-yaml", "4.1.0"],
        ["json-stable-stringify-without-jsonify", "1.0.1"],
        ["levn", "0.4.1"],
        ["lodash.merge", "4.6.2"],
        ["minimatch", "3.1.2"],
        ["natural-compare", "1.4.0"],
        ["optionator", "0.9.3"],
        ["strip-ansi", "6.0.1"],
        ["text-table", "0.2.0"],
        ["eslint", "8.56.0"],
      ]),
    }],
  ])],
  ["@eslint/eslintrc", new Map([
    ["2.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-eslintrc-2.1.4-388a269f0f25c1b6adc317b5a2c55714894c70ad-integrity/node_modules/@eslint/eslintrc/"),
      packageDependencies: new Map([
        ["ajv", "6.12.6"],
        ["debug", "4.3.4"],
        ["espree", "9.6.1"],
        ["globals", "13.24.0"],
        ["ignore", "5.3.0"],
        ["import-fresh", "3.3.0"],
        ["js-yaml", "4.1.0"],
        ["minimatch", "3.1.2"],
        ["strip-json-comments", "3.1.1"],
        ["@eslint/eslintrc", "2.1.4"],
      ]),
    }],
  ])],
  ["ajv", new Map([
    ["6.12.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4-integrity/node_modules/ajv/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
        ["fast-json-stable-stringify", "2.1.0"],
        ["json-schema-traverse", "0.4.1"],
        ["uri-js", "4.4.1"],
        ["ajv", "6.12.6"],
      ]),
    }],
  ])],
  ["fast-deep-equal", new Map([
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525-integrity/node_modules/fast-deep-equal/"),
      packageDependencies: new Map([
        ["fast-deep-equal", "3.1.3"],
      ]),
    }],
  ])],
  ["fast-json-stable-stringify", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/"),
      packageDependencies: new Map([
        ["fast-json-stable-stringify", "2.1.0"],
      ]),
    }],
  ])],
  ["json-schema-traverse", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/"),
      packageDependencies: new Map([
        ["json-schema-traverse", "0.4.1"],
      ]),
    }],
  ])],
  ["uri-js", new Map([
    ["4.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-uri-js-4.4.1-9b1a52595225859e55f669d928f88c6c57f2a77e-integrity/node_modules/uri-js/"),
      packageDependencies: new Map([
        ["punycode", "2.3.1"],
        ["uri-js", "4.4.1"],
      ]),
    }],
  ])],
  ["punycode", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-punycode-2.3.1-027422e2faec0b25e1549c3e1bd8309b9133b6e5-integrity/node_modules/punycode/"),
      packageDependencies: new Map([
        ["punycode", "2.3.1"],
      ]),
    }],
  ])],
  ["espree", new Map([
    ["9.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-espree-9.6.1-a2a17b8e434690a5432f2f8018ce71d331a48c6f-integrity/node_modules/espree/"),
      packageDependencies: new Map([
        ["acorn", "8.11.3"],
        ["acorn-jsx", "5.3.2"],
        ["eslint-visitor-keys", "3.4.3"],
        ["espree", "9.6.1"],
      ]),
    }],
  ])],
  ["acorn", new Map([
    ["8.11.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-8.11.3-71e0b14e13a4ec160724b38fb7b0f233b1b81d7a-integrity/node_modules/acorn/"),
      packageDependencies: new Map([
        ["acorn", "8.11.3"],
      ]),
    }],
  ])],
  ["acorn-jsx", new Map([
    ["5.3.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-jsx-5.3.2-7ed5bb55908b3b2f1bc55c6af1653bada7f07937-integrity/node_modules/acorn-jsx/"),
      packageDependencies: new Map([
        ["acorn", "8.11.3"],
        ["acorn-jsx", "5.3.2"],
      ]),
    }],
  ])],
  ["globals", new Map([
    ["13.24.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-globals-13.24.0-8432a19d78ce0c1e833949c36adb345400bb1171-integrity/node_modules/globals/"),
      packageDependencies: new Map([
        ["type-fest", "0.20.2"],
        ["globals", "13.24.0"],
      ]),
    }],
  ])],
  ["type-fest", new Map([
    ["0.20.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-type-fest-0.20.2-1bf207f4b28f91583666cb5fbd327887301cd5f4-integrity/node_modules/type-fest/"),
      packageDependencies: new Map([
        ["type-fest", "0.20.2"],
      ]),
    }],
  ])],
  ["import-fresh", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-import-fresh-3.3.0-37162c25fcb9ebaa2e6e53d5b4d88ce17d9e0c2b-integrity/node_modules/import-fresh/"),
      packageDependencies: new Map([
        ["parent-module", "1.0.1"],
        ["resolve-from", "4.0.0"],
        ["import-fresh", "3.3.0"],
      ]),
    }],
  ])],
  ["parent-module", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2-integrity/node_modules/parent-module/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
        ["parent-module", "1.0.1"],
      ]),
    }],
  ])],
  ["callsites", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73-integrity/node_modules/callsites/"),
      packageDependencies: new Map([
        ["callsites", "3.1.0"],
      ]),
    }],
  ])],
  ["resolve-from", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6-integrity/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "4.0.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69-integrity/node_modules/resolve-from/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
      ]),
    }],
  ])],
  ["js-yaml", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-js-yaml-4.1.0-c1fb65f8f5017901cdd2c951864ba18458a10602-integrity/node_modules/js-yaml/"),
      packageDependencies: new Map([
        ["argparse", "2.0.1"],
        ["js-yaml", "4.1.0"],
      ]),
    }],
  ])],
  ["argparse", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-argparse-2.0.1-246f50f3ca78a3240f6c997e8a9bd1eac49e4b38-integrity/node_modules/argparse/"),
      packageDependencies: new Map([
        ["argparse", "2.0.1"],
      ]),
    }],
  ])],
  ["concat-map", new Map([
    ["0.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/"),
      packageDependencies: new Map([
        ["concat-map", "0.0.1"],
      ]),
    }],
  ])],
  ["strip-json-comments", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-json-comments-3.1.1-31f1281b3832630434831c310c01cccda8cbe006-integrity/node_modules/strip-json-comments/"),
      packageDependencies: new Map([
        ["strip-json-comments", "3.1.1"],
      ]),
    }],
  ])],
  ["@eslint/js", new Map([
    ["8.56.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-js-8.56.0-ef20350fec605a7f7035a01764731b2de0f3782b-integrity/node_modules/@eslint/js/"),
      packageDependencies: new Map([
        ["@eslint/js", "8.56.0"],
      ]),
    }],
  ])],
  ["@humanwhocodes/config-array", new Map([
    ["0.11.14", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-config-array-0.11.14-d78e481a039f7566ecc9660b4ea7fe6b1fec442b-integrity/node_modules/@humanwhocodes/config-array/"),
      packageDependencies: new Map([
        ["@humanwhocodes/object-schema", "2.0.2"],
        ["debug", "4.3.4"],
        ["minimatch", "3.1.2"],
        ["@humanwhocodes/config-array", "0.11.14"],
      ]),
    }],
  ])],
  ["@humanwhocodes/object-schema", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-object-schema-2.0.2-d9fae00a2d5cb40f92cfe64b47ad749fbc38f917-integrity/node_modules/@humanwhocodes/object-schema/"),
      packageDependencies: new Map([
        ["@humanwhocodes/object-schema", "2.0.2"],
      ]),
    }],
  ])],
  ["@humanwhocodes/module-importer", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-module-importer-1.0.1-af5b2691a22b44be847b0ca81641c5fb6ad0172c-integrity/node_modules/@humanwhocodes/module-importer/"),
      packageDependencies: new Map([
        ["@humanwhocodes/module-importer", "1.0.1"],
      ]),
    }],
  ])],
  ["@ungap/structured-clone", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@ungap-structured-clone-1.2.0-756641adb587851b5ccb3e095daf27ae581c8406-integrity/node_modules/@ungap/structured-clone/"),
      packageDependencies: new Map([
        ["@ungap/structured-clone", "1.2.0"],
      ]),
    }],
  ])],
  ["chalk", new Map([
    ["4.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chalk-4.1.2-aac4e2b7734a740867aeb16bf02aad556a1e7a01-integrity/node_modules/chalk/"),
      packageDependencies: new Map([
        ["ansi-styles", "4.3.0"],
        ["supports-color", "7.2.0"],
        ["chalk", "4.1.2"],
      ]),
    }],
  ])],
  ["ansi-styles", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-styles-4.3.0-edd803628ae71c04c85ae7a0906edad34b648937-integrity/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["color-convert", "2.0.1"],
        ["ansi-styles", "4.3.0"],
      ]),
    }],
    ["6.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-styles-6.2.1-0e62320cf99c21afff3b3012192546aacbfb05c5-integrity/node_modules/ansi-styles/"),
      packageDependencies: new Map([
        ["ansi-styles", "6.2.1"],
      ]),
    }],
  ])],
  ["color-convert", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-color-convert-2.0.1-72d3a68d598c9bdb3af2ad1e84f21d896abd4de3-integrity/node_modules/color-convert/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
        ["color-convert", "2.0.1"],
      ]),
    }],
  ])],
  ["color-name", new Map([
    ["1.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2-integrity/node_modules/color-name/"),
      packageDependencies: new Map([
        ["color-name", "1.1.4"],
      ]),
    }],
  ])],
  ["supports-color", new Map([
    ["7.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-7.2.0-1b7dcdcb32b8138801b3e478ba6a51caa89648da-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
        ["supports-color", "7.2.0"],
      ]),
    }],
    ["8.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-8.1.1-cd6fc17e28500cff56c1b86c0a7fd4a54a73005c-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
        ["supports-color", "8.1.1"],
      ]),
    }],
    ["9.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-9.4.0-17bfcf686288f531db3dea3215510621ccb55954-integrity/node_modules/supports-color/"),
      packageDependencies: new Map([
        ["supports-color", "9.4.0"],
      ]),
    }],
  ])],
  ["has-flag", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b-integrity/node_modules/has-flag/"),
      packageDependencies: new Map([
        ["has-flag", "4.0.0"],
      ]),
    }],
  ])],
  ["cross-spawn", new Map([
    ["7.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6-integrity/node_modules/cross-spawn/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
        ["shebang-command", "2.0.0"],
        ["which", "2.0.2"],
        ["cross-spawn", "7.0.3"],
      ]),
    }],
  ])],
  ["path-key", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375-integrity/node_modules/path-key/"),
      packageDependencies: new Map([
        ["path-key", "3.1.1"],
      ]),
    }],
  ])],
  ["shebang-command", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea-integrity/node_modules/shebang-command/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
        ["shebang-command", "2.0.0"],
      ]),
    }],
  ])],
  ["shebang-regex", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172-integrity/node_modules/shebang-regex/"),
      packageDependencies: new Map([
        ["shebang-regex", "3.0.0"],
      ]),
    }],
  ])],
  ["which", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1-integrity/node_modules/which/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
        ["which", "2.0.2"],
      ]),
    }],
  ])],
  ["isexe", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/"),
      packageDependencies: new Map([
        ["isexe", "2.0.0"],
      ]),
    }],
  ])],
  ["doctrine", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961-integrity/node_modules/doctrine/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
        ["doctrine", "3.0.0"],
      ]),
    }],
  ])],
  ["esutils", new Map([
    ["2.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64-integrity/node_modules/esutils/"),
      packageDependencies: new Map([
        ["esutils", "2.0.3"],
      ]),
    }],
  ])],
  ["escape-string-regexp", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-escape-string-regexp-4.0.0-14ba83a5d373e3d311e5afca29cf5bfad965bf34-integrity/node_modules/escape-string-regexp/"),
      packageDependencies: new Map([
        ["escape-string-regexp", "4.0.0"],
      ]),
    }],
  ])],
  ["eslint-scope", new Map([
    ["7.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-scope-7.2.2-deb4f92563390f32006894af62a22dba1c46423f-integrity/node_modules/eslint-scope/"),
      packageDependencies: new Map([
        ["esrecurse", "4.3.0"],
        ["estraverse", "5.3.0"],
        ["eslint-scope", "7.2.2"],
      ]),
    }],
    ["5.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-scope-5.1.1-e786e59a66cb92b3f6c1fb0d508aab174848f48c-integrity/node_modules/eslint-scope/"),
      packageDependencies: new Map([
        ["esrecurse", "4.3.0"],
        ["estraverse", "4.3.0"],
        ["eslint-scope", "5.1.1"],
      ]),
    }],
  ])],
  ["esrecurse", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esrecurse-4.3.0-7ad7964d679abb28bee72cec63758b1c5d2c9921-integrity/node_modules/esrecurse/"),
      packageDependencies: new Map([
        ["estraverse", "5.3.0"],
        ["esrecurse", "4.3.0"],
      ]),
    }],
  ])],
  ["estraverse", new Map([
    ["5.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-estraverse-5.3.0-2eea5290702f26ab8fe5370370ff86c965d21123-integrity/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "5.3.0"],
      ]),
    }],
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/"),
      packageDependencies: new Map([
        ["estraverse", "4.3.0"],
      ]),
    }],
  ])],
  ["esquery", new Map([
    ["1.5.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esquery-1.5.0-6ce17738de8577694edd7361c57182ac8cb0db0b-integrity/node_modules/esquery/"),
      packageDependencies: new Map([
        ["estraverse", "5.3.0"],
        ["esquery", "1.5.0"],
      ]),
    }],
  ])],
  ["file-entry-cache", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-file-entry-cache-6.0.1-211b2dd9659cb0394b073e7323ac3c933d522027-integrity/node_modules/file-entry-cache/"),
      packageDependencies: new Map([
        ["flat-cache", "3.2.0"],
        ["file-entry-cache", "6.0.1"],
      ]),
    }],
  ])],
  ["flat-cache", new Map([
    ["3.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flat-cache-3.2.0-2c0c2d5040c99b1632771a9d105725c0115363ee-integrity/node_modules/flat-cache/"),
      packageDependencies: new Map([
        ["flatted", "3.2.9"],
        ["keyv", "4.5.4"],
        ["rimraf", "3.0.2"],
        ["flat-cache", "3.2.0"],
      ]),
    }],
  ])],
  ["flatted", new Map([
    ["3.2.9", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flatted-3.2.9-7eb4c67ca1ba34232ca9d2d93e9886e611ad7daf-integrity/node_modules/flatted/"),
      packageDependencies: new Map([
        ["flatted", "3.2.9"],
      ]),
    }],
  ])],
  ["keyv", new Map([
    ["4.5.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-keyv-4.5.4-a879a99e29452f942439f2a405e3af8b31d4de93-integrity/node_modules/keyv/"),
      packageDependencies: new Map([
        ["json-buffer", "3.0.1"],
        ["keyv", "4.5.4"],
      ]),
    }],
  ])],
  ["json-buffer", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-buffer-3.0.1-9338802a30d3b6605fbe0613e094008ca8c05a13-integrity/node_modules/json-buffer/"),
      packageDependencies: new Map([
        ["json-buffer", "3.0.1"],
      ]),
    }],
  ])],
  ["rimraf", new Map([
    ["3.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a-integrity/node_modules/rimraf/"),
      packageDependencies: new Map([
        ["glob", "7.2.3"],
        ["rimraf", "3.0.2"],
      ]),
    }],
  ])],
  ["glob", new Map([
    ["7.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-7.2.3-b8df0fb802bbfa8e89bd1d938b4e16578ed44f2b-integrity/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.1.2"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.2.3"],
      ]),
    }],
    ["10.3.10", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-10.3.10-0351ebb809fd187fe421ab96af83d3a70715df4b-integrity/node_modules/glob/"),
      packageDependencies: new Map([
        ["foreground-child", "3.1.1"],
        ["jackspeak", "2.3.6"],
        ["minimatch", "9.0.3"],
        ["minipass", "7.0.4"],
        ["path-scurry", "1.10.1"],
        ["glob", "10.3.10"],
      ]),
    }],
    ["7.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-7.2.0-d15535af7732e02e948f4c41628bd910293f6023-integrity/node_modules/glob/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
        ["inflight", "1.0.6"],
        ["inherits", "2.0.4"],
        ["minimatch", "3.1.2"],
        ["once", "1.4.0"],
        ["path-is-absolute", "1.0.1"],
        ["glob", "7.2.0"],
      ]),
    }],
  ])],
  ["fs.realpath", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/"),
      packageDependencies: new Map([
        ["fs.realpath", "1.0.0"],
      ]),
    }],
  ])],
  ["inflight", new Map([
    ["1.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/"),
      packageDependencies: new Map([
        ["once", "1.4.0"],
        ["wrappy", "1.0.2"],
        ["inflight", "1.0.6"],
      ]),
    }],
  ])],
  ["once", new Map([
    ["1.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
        ["once", "1.4.0"],
      ]),
    }],
  ])],
  ["wrappy", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/"),
      packageDependencies: new Map([
        ["wrappy", "1.0.2"],
      ]),
    }],
  ])],
  ["inherits", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/"),
      packageDependencies: new Map([
        ["inherits", "2.0.4"],
      ]),
    }],
  ])],
  ["path-is-absolute", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/"),
      packageDependencies: new Map([
        ["path-is-absolute", "1.0.1"],
      ]),
    }],
  ])],
  ["find-up", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-find-up-5.0.0-4c92819ecb7083561e4f4a240a86be5198f536fc-integrity/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "6.0.0"],
        ["path-exists", "4.0.0"],
        ["find-up", "5.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19-integrity/node_modules/find-up/"),
      packageDependencies: new Map([
        ["locate-path", "5.0.0"],
        ["path-exists", "4.0.0"],
        ["find-up", "4.1.0"],
      ]),
    }],
  ])],
  ["locate-path", new Map([
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-locate-path-6.0.0-55321eb309febbc59c4801d931a72452a681d286-integrity/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "5.0.0"],
        ["locate-path", "6.0.0"],
      ]),
    }],
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0-integrity/node_modules/locate-path/"),
      packageDependencies: new Map([
        ["p-locate", "4.1.0"],
        ["locate-path", "5.0.0"],
      ]),
    }],
  ])],
  ["p-locate", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-locate-5.0.0-83c8315c6785005e3bd021839411c9e110e6d834-integrity/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "3.1.0"],
        ["p-locate", "5.0.0"],
      ]),
    }],
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07-integrity/node_modules/p-locate/"),
      packageDependencies: new Map([
        ["p-limit", "2.3.0"],
        ["p-locate", "4.1.0"],
      ]),
    }],
  ])],
  ["p-limit", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-limit-3.1.0-e1daccbe78d0d1388ca18c64fea38e3e57e3706b-integrity/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["yocto-queue", "0.1.0"],
        ["p-limit", "3.1.0"],
      ]),
    }],
    ["2.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1-integrity/node_modules/p-limit/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
        ["p-limit", "2.3.0"],
      ]),
    }],
  ])],
  ["yocto-queue", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yocto-queue-0.1.0-0294eb3dee05028d31ee1a5fa2c556a6aaf10a1b-integrity/node_modules/yocto-queue/"),
      packageDependencies: new Map([
        ["yocto-queue", "0.1.0"],
      ]),
    }],
  ])],
  ["path-exists", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3-integrity/node_modules/path-exists/"),
      packageDependencies: new Map([
        ["path-exists", "4.0.0"],
      ]),
    }],
  ])],
  ["imurmurhash", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea-integrity/node_modules/imurmurhash/"),
      packageDependencies: new Map([
        ["imurmurhash", "0.1.4"],
      ]),
    }],
  ])],
  ["is-path-inside", new Map([
    ["3.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-path-inside-3.0.3-d231362e53a07ff2b0e0ea7fed049161ffd16283-integrity/node_modules/is-path-inside/"),
      packageDependencies: new Map([
        ["is-path-inside", "3.0.3"],
      ]),
    }],
  ])],
  ["json-stable-stringify-without-jsonify", new Map([
    ["1.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651-integrity/node_modules/json-stable-stringify-without-jsonify/"),
      packageDependencies: new Map([
        ["json-stable-stringify-without-jsonify", "1.0.1"],
      ]),
    }],
  ])],
  ["levn", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-levn-0.4.1-ae4562c007473b932a6200d403268dd2fffc6ade-integrity/node_modules/levn/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.2.1"],
        ["type-check", "0.4.0"],
        ["levn", "0.4.1"],
      ]),
    }],
  ])],
  ["prelude-ls", new Map([
    ["1.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-prelude-ls-1.2.1-debc6489d7a6e6b0e7611888cec880337d316396-integrity/node_modules/prelude-ls/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.2.1"],
      ]),
    }],
  ])],
  ["type-check", new Map([
    ["0.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-type-check-0.4.0-07b8203bfa7056c0657050e3ccd2c37730bab8f1-integrity/node_modules/type-check/"),
      packageDependencies: new Map([
        ["prelude-ls", "1.2.1"],
        ["type-check", "0.4.0"],
      ]),
    }],
  ])],
  ["lodash.merge", new Map([
    ["4.6.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lodash-merge-4.6.2-558aa53b43b661e1925a0afdfa36a9a1085fe57a-integrity/node_modules/lodash.merge/"),
      packageDependencies: new Map([
        ["lodash.merge", "4.6.2"],
      ]),
    }],
  ])],
  ["optionator", new Map([
    ["0.9.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-optionator-0.9.3-007397d44ed1872fdc6ed31360190f81814e2c64-integrity/node_modules/optionator/"),
      packageDependencies: new Map([
        ["@aashutoshrathi/word-wrap", "1.2.6"],
        ["deep-is", "0.1.4"],
        ["fast-levenshtein", "2.0.6"],
        ["levn", "0.4.1"],
        ["prelude-ls", "1.2.1"],
        ["type-check", "0.4.0"],
        ["optionator", "0.9.3"],
      ]),
    }],
  ])],
  ["@aashutoshrathi/word-wrap", new Map([
    ["1.2.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@aashutoshrathi-word-wrap-1.2.6-bd9154aec9983f77b3a034ecaa015c2e4201f6cf-integrity/node_modules/@aashutoshrathi/word-wrap/"),
      packageDependencies: new Map([
        ["@aashutoshrathi/word-wrap", "1.2.6"],
      ]),
    }],
  ])],
  ["deep-is", new Map([
    ["0.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-deep-is-0.1.4-a6f2dce612fadd2ef1f519b73551f17e85199831-integrity/node_modules/deep-is/"),
      packageDependencies: new Map([
        ["deep-is", "0.1.4"],
      ]),
    }],
  ])],
  ["fast-levenshtein", new Map([
    ["2.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917-integrity/node_modules/fast-levenshtein/"),
      packageDependencies: new Map([
        ["fast-levenshtein", "2.0.6"],
      ]),
    }],
  ])],
  ["strip-ansi", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-6.0.1-9e26c63d30f53443e9489495b2105d37b67a85d9-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.1"],
        ["strip-ansi", "6.0.1"],
      ]),
    }],
    ["7.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-7.1.0-d5b6568ca689d8561370b0707685d22434faff45-integrity/node_modules/strip-ansi/"),
      packageDependencies: new Map([
        ["ansi-regex", "6.0.1"],
        ["strip-ansi", "7.1.0"],
      ]),
    }],
  ])],
  ["ansi-regex", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-regex-5.0.1-082cb2c89c9fe8659a311a53bd6a4dc5301db304-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.1"],
      ]),
    }],
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-regex-6.0.1-3183e38fae9a65d7cb5e53945cd5897d0260a06a-integrity/node_modules/ansi-regex/"),
      packageDependencies: new Map([
        ["ansi-regex", "6.0.1"],
      ]),
    }],
  ])],
  ["text-table", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4-integrity/node_modules/text-table/"),
      packageDependencies: new Map([
        ["text-table", "0.2.0"],
      ]),
    }],
  ])],
  ["typescript", new Map([
    ["5.3.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-typescript-5.3.3-b3ce6ba258e72e6305ba66f5c9b452aaee3ffe37-integrity/node_modules/typescript/"),
      packageDependencies: new Map([
        ["typescript", "5.3.3"],
      ]),
    }],
  ])],
  ["ts-loader", new Map([
    ["9.5.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ts-loader-9.5.1-63d5912a86312f1fbe32cef0859fb8b2193d9b89-integrity/node_modules/ts-loader/"),
      packageDependencies: new Map([
        ["typescript", "5.3.3"],
        ["webpack", "5.89.0"],
        ["chalk", "4.1.2"],
        ["enhanced-resolve", "5.15.0"],
        ["micromatch", "4.0.5"],
        ["semver", "7.5.4"],
        ["source-map", "0.7.4"],
        ["ts-loader", "9.5.1"],
      ]),
    }],
  ])],
  ["enhanced-resolve", new Map([
    ["5.15.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-enhanced-resolve-5.15.0-1af946c7d93603eb88e9896cee4904dc012e9c35-integrity/node_modules/enhanced-resolve/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.11"],
        ["tapable", "2.2.1"],
        ["enhanced-resolve", "5.15.0"],
      ]),
    }],
  ])],
  ["graceful-fs", new Map([
    ["4.2.11", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-graceful-fs-4.2.11-4183e4e8bf08bb6e05bbb2f7d2e0c8f712ca40e3-integrity/node_modules/graceful-fs/"),
      packageDependencies: new Map([
        ["graceful-fs", "4.2.11"],
      ]),
    }],
  ])],
  ["tapable", new Map([
    ["2.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-tapable-2.2.1-1967a73ef4060a82f12ab96af86d52fdb76eeca0-integrity/node_modules/tapable/"),
      packageDependencies: new Map([
        ["tapable", "2.2.1"],
      ]),
    }],
  ])],
  ["source-map", new Map([
    ["0.7.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-0.7.4-a9bbe705c9d8846f4e08ff6765acf0f1b0898656-integrity/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.7.4"],
      ]),
    }],
    ["0.6.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/"),
      packageDependencies: new Map([
        ["source-map", "0.6.1"],
      ]),
    }],
  ])],
  ["webpack", new Map([
    ["5.89.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-5.89.0-56b8bf9a34356e93a6625770006490bf3a7f32dc-integrity/node_modules/webpack/"),
      packageDependencies: new Map([
        ["@types/eslint-scope", "3.7.7"],
        ["@types/estree", "1.0.5"],
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/wasm-edit", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["acorn", "8.11.3"],
        ["acorn-import-assertions", "1.9.0"],
        ["browserslist", "4.22.2"],
        ["chrome-trace-event", "1.0.3"],
        ["enhanced-resolve", "5.15.0"],
        ["es-module-lexer", "1.4.1"],
        ["eslint-scope", "5.1.1"],
        ["events", "3.3.0"],
        ["glob-to-regexp", "0.4.1"],
        ["graceful-fs", "4.2.11"],
        ["json-parse-even-better-errors", "2.3.1"],
        ["loader-runner", "4.3.0"],
        ["mime-types", "2.1.35"],
        ["neo-async", "2.6.2"],
        ["schema-utils", "3.3.0"],
        ["tapable", "2.2.1"],
        ["terser-webpack-plugin", "5.3.10"],
        ["watchpack", "2.4.0"],
        ["webpack-sources", "3.2.3"],
        ["webpack", "5.89.0"],
      ]),
    }],
  ])],
  ["@types/eslint-scope", new Map([
    ["3.7.7", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-eslint-scope-3.7.7-3108bd5f18b0cdb277c867b3dd449c9ed7079ac5-integrity/node_modules/@types/eslint-scope/"),
      packageDependencies: new Map([
        ["@types/eslint", "8.56.2"],
        ["@types/estree", "1.0.5"],
        ["@types/eslint-scope", "3.7.7"],
      ]),
    }],
  ])],
  ["@types/eslint", new Map([
    ["8.56.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-eslint-8.56.2-1c72a9b794aa26a8b94ad26d5b9aa51c8a6384bb-integrity/node_modules/@types/eslint/"),
      packageDependencies: new Map([
        ["@types/estree", "1.0.5"],
        ["@types/json-schema", "7.0.15"],
        ["@types/eslint", "8.56.2"],
      ]),
    }],
  ])],
  ["@types/estree", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-estree-1.0.5-a6ce3e556e00fd9895dd872dd172ad0d4bd687f4-integrity/node_modules/@types/estree/"),
      packageDependencies: new Map([
        ["@types/estree", "1.0.5"],
      ]),
    }],
  ])],
  ["@webassemblyjs/ast", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ast-1.11.6-db046555d3c413f8966ca50a95176a0e2c642e24-integrity/node_modules/@webassemblyjs/ast/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-numbers", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ast", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-numbers", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-numbers-1.11.6-cbce5e7e0c1bd32cf4905ae444ef64cea919f1b5-integrity/node_modules/@webassemblyjs/helper-numbers/"),
      packageDependencies: new Map([
        ["@webassemblyjs/floating-point-hex-parser", "1.11.6"],
        ["@webassemblyjs/helper-api-error", "1.11.6"],
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/helper-numbers", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/floating-point-hex-parser", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-floating-point-hex-parser-1.11.6-dacbcb95aff135c8260f77fa3b4c5fea600a6431-integrity/node_modules/@webassemblyjs/floating-point-hex-parser/"),
      packageDependencies: new Map([
        ["@webassemblyjs/floating-point-hex-parser", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-api-error", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-api-error-1.11.6-6132f68c4acd59dcd141c44b18cbebbd9f2fa768-integrity/node_modules/@webassemblyjs/helper-api-error/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-api-error", "1.11.6"],
      ]),
    }],
  ])],
  ["@xtuc/long", new Map([
    ["4.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@xtuc-long-4.2.2-d291c6a4e97989b5c61d9acf396ae4fe133a718d-integrity/node_modules/@xtuc/long/"),
      packageDependencies: new Map([
        ["@xtuc/long", "4.2.2"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-wasm-bytecode", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-bytecode-1.11.6-bb2ebdb3b83aa26d9baad4c46d4315283acd51e9-integrity/node_modules/@webassemblyjs/helper-wasm-bytecode/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-edit", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-edit-1.11.6-c72fa8220524c9b416249f3d94c2958dfe70ceab-integrity/node_modules/@webassemblyjs/wasm-edit/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/helper-wasm-section", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/wasm-opt", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["@webassemblyjs/wast-printer", "1.11.6"],
        ["@webassemblyjs/wasm-edit", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-buffer", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-buffer-1.11.6-b66d73c43e296fd5e88006f18524feb0f2c7c093-integrity/node_modules/@webassemblyjs/helper-buffer/"),
      packageDependencies: new Map([
        ["@webassemblyjs/helper-buffer", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/helper-wasm-section", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-section-1.11.6-ff97f3863c55ee7f580fd5c41a381e9def4aa577-integrity/node_modules/@webassemblyjs/helper-wasm-section/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/helper-wasm-section", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-gen", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-gen-1.11.6-fb5283e0e8b4551cc4e9c3c0d7184a65faf7c268-integrity/node_modules/@webassemblyjs/wasm-gen/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ieee754", "1.11.6"],
        ["@webassemblyjs/leb128", "1.11.6"],
        ["@webassemblyjs/utf8", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/ieee754", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ieee754-1.11.6-bb665c91d0b14fffceb0e38298c329af043c6e3a-integrity/node_modules/@webassemblyjs/ieee754/"),
      packageDependencies: new Map([
        ["@xtuc/ieee754", "1.2.0"],
        ["@webassemblyjs/ieee754", "1.11.6"],
      ]),
    }],
  ])],
  ["@xtuc/ieee754", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@xtuc-ieee754-1.2.0-eef014a3145ae477a1cbc00cd1e552336dceb790-integrity/node_modules/@xtuc/ieee754/"),
      packageDependencies: new Map([
        ["@xtuc/ieee754", "1.2.0"],
      ]),
    }],
  ])],
  ["@webassemblyjs/leb128", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-leb128-1.11.6-70e60e5e82f9ac81118bc25381a0b283893240d7-integrity/node_modules/@webassemblyjs/leb128/"),
      packageDependencies: new Map([
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/leb128", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/utf8", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-utf8-1.11.6-90f8bc34c561595fe156603be7253cdbcd0fab5a-integrity/node_modules/@webassemblyjs/utf8/"),
      packageDependencies: new Map([
        ["@webassemblyjs/utf8", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-opt", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-opt-1.11.6-d9a22d651248422ca498b09aa3232a81041487c2-integrity/node_modules/@webassemblyjs/wasm-opt/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-buffer", "1.11.6"],
        ["@webassemblyjs/wasm-gen", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
        ["@webassemblyjs/wasm-opt", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wasm-parser", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-parser-1.11.6-bb85378c527df824004812bbdb784eea539174a1-integrity/node_modules/@webassemblyjs/wasm-parser/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@webassemblyjs/helper-api-error", "1.11.6"],
        ["@webassemblyjs/helper-wasm-bytecode", "1.11.6"],
        ["@webassemblyjs/ieee754", "1.11.6"],
        ["@webassemblyjs/leb128", "1.11.6"],
        ["@webassemblyjs/utf8", "1.11.6"],
        ["@webassemblyjs/wasm-parser", "1.11.6"],
      ]),
    }],
  ])],
  ["@webassemblyjs/wast-printer", new Map([
    ["1.11.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wast-printer-1.11.6-a7bf8dd7e362aeb1668ff43f35cb849f188eff20-integrity/node_modules/@webassemblyjs/wast-printer/"),
      packageDependencies: new Map([
        ["@webassemblyjs/ast", "1.11.6"],
        ["@xtuc/long", "4.2.2"],
        ["@webassemblyjs/wast-printer", "1.11.6"],
      ]),
    }],
  ])],
  ["acorn-import-assertions", new Map([
    ["1.9.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-import-assertions-1.9.0-507276249d684797c84e0734ef84860334cfb1ac-integrity/node_modules/acorn-import-assertions/"),
      packageDependencies: new Map([
        ["acorn", "8.11.3"],
        ["acorn-import-assertions", "1.9.0"],
      ]),
    }],
  ])],
  ["browserslist", new Map([
    ["4.22.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-browserslist-4.22.2-704c4943072bd81ea18997f3bd2180e89c77874b-integrity/node_modules/browserslist/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30001576"],
        ["electron-to-chromium", "1.4.629"],
        ["node-releases", "2.0.14"],
        ["update-browserslist-db", "1.0.13"],
        ["browserslist", "4.22.2"],
      ]),
    }],
  ])],
  ["caniuse-lite", new Map([
    ["1.0.30001576", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-caniuse-lite-1.0.30001576-893be772cf8ee6056d6c1e2d07df365b9ec0a5c4-integrity/node_modules/caniuse-lite/"),
      packageDependencies: new Map([
        ["caniuse-lite", "1.0.30001576"],
      ]),
    }],
  ])],
  ["electron-to-chromium", new Map([
    ["1.4.629", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-electron-to-chromium-1.4.629-9cbffe1b08a5627b6a25118360f7fd3965416caf-integrity/node_modules/electron-to-chromium/"),
      packageDependencies: new Map([
        ["electron-to-chromium", "1.4.629"],
      ]),
    }],
  ])],
  ["node-releases", new Map([
    ["2.0.14", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-node-releases-2.0.14-2ffb053bceb8b2be8495ece1ab6ce600c4461b0b-integrity/node_modules/node-releases/"),
      packageDependencies: new Map([
        ["node-releases", "2.0.14"],
      ]),
    }],
  ])],
  ["update-browserslist-db", new Map([
    ["1.0.13", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-update-browserslist-db-1.0.13-3c5e4f5c083661bd38ef64b6328c26ed6c8248c4-integrity/node_modules/update-browserslist-db/"),
      packageDependencies: new Map([
        ["escalade", "3.1.1"],
        ["picocolors", "1.0.0"],
        ["update-browserslist-db", "1.0.13"],
      ]),
    }],
  ])],
  ["escalade", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-escalade-3.1.1-d8cfdc7000965c5a0174b4a82eaa5c0552742e40-integrity/node_modules/escalade/"),
      packageDependencies: new Map([
        ["escalade", "3.1.1"],
      ]),
    }],
  ])],
  ["picocolors", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-picocolors-1.0.0-cb5bdc74ff3f51892236eaf79d68bc44564ab81c-integrity/node_modules/picocolors/"),
      packageDependencies: new Map([
        ["picocolors", "1.0.0"],
      ]),
    }],
  ])],
  ["chrome-trace-event", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chrome-trace-event-1.0.3-1015eced4741e15d06664a957dbbf50d041e26ac-integrity/node_modules/chrome-trace-event/"),
      packageDependencies: new Map([
        ["chrome-trace-event", "1.0.3"],
      ]),
    }],
  ])],
  ["es-module-lexer", new Map([
    ["1.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-es-module-lexer-1.4.1-41ea21b43908fe6a287ffcbe4300f790555331f5-integrity/node_modules/es-module-lexer/"),
      packageDependencies: new Map([
        ["es-module-lexer", "1.4.1"],
      ]),
    }],
  ])],
  ["events", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-events-3.3.0-31a95ad0a924e2d2c419a813aeb2c4e878ea7400-integrity/node_modules/events/"),
      packageDependencies: new Map([
        ["events", "3.3.0"],
      ]),
    }],
  ])],
  ["glob-to-regexp", new Map([
    ["0.4.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-to-regexp-0.4.1-c75297087c851b9a578bd217dd59a92f59fe546e-integrity/node_modules/glob-to-regexp/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.4.1"],
      ]),
    }],
  ])],
  ["json-parse-even-better-errors", new Map([
    ["2.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d-integrity/node_modules/json-parse-even-better-errors/"),
      packageDependencies: new Map([
        ["json-parse-even-better-errors", "2.3.1"],
      ]),
    }],
  ])],
  ["loader-runner", new Map([
    ["4.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-loader-runner-4.3.0-c1b4a163b99f614830353b16755e7149ac2314e1-integrity/node_modules/loader-runner/"),
      packageDependencies: new Map([
        ["loader-runner", "4.3.0"],
      ]),
    }],
  ])],
  ["mime-types", new Map([
    ["2.1.35", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mime-types-2.1.35-381a871b62a734450660ae3deee44813f70d959a-integrity/node_modules/mime-types/"),
      packageDependencies: new Map([
        ["mime-db", "1.52.0"],
        ["mime-types", "2.1.35"],
      ]),
    }],
  ])],
  ["mime-db", new Map([
    ["1.52.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mime-db-1.52.0-bbabcdc02859f4987301c856e3387ce5ec43bf70-integrity/node_modules/mime-db/"),
      packageDependencies: new Map([
        ["mime-db", "1.52.0"],
      ]),
    }],
  ])],
  ["neo-async", new Map([
    ["2.6.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-neo-async-2.6.2-b4aafb93e3aeb2d8174ca53cf163ab7d7308305f-integrity/node_modules/neo-async/"),
      packageDependencies: new Map([
        ["neo-async", "2.6.2"],
      ]),
    }],
  ])],
  ["schema-utils", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-schema-utils-3.3.0-f50a88877c3c01652a15b622ae9e9795df7a60fe-integrity/node_modules/schema-utils/"),
      packageDependencies: new Map([
        ["@types/json-schema", "7.0.15"],
        ["ajv", "6.12.6"],
        ["ajv-keywords", "3.5.2"],
        ["schema-utils", "3.3.0"],
      ]),
    }],
  ])],
  ["ajv-keywords", new Map([
    ["3.5.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-3.5.2-31f29da5ab6e00d1c2d329acf7b5929614d5014d-integrity/node_modules/ajv-keywords/"),
      packageDependencies: new Map([
        ["ajv", "6.12.6"],
        ["ajv-keywords", "3.5.2"],
      ]),
    }],
  ])],
  ["terser-webpack-plugin", new Map([
    ["5.3.10", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-terser-webpack-plugin-5.3.10-904f4c9193c6fd2a03f693a2150c62a92f40d199-integrity/node_modules/terser-webpack-plugin/"),
      packageDependencies: new Map([
        ["@jridgewell/trace-mapping", "0.3.21"],
        ["jest-worker", "27.5.1"],
        ["schema-utils", "3.3.0"],
        ["serialize-javascript", "6.0.2"],
        ["terser", "5.26.0"],
        ["terser-webpack-plugin", "5.3.10"],
      ]),
    }],
  ])],
  ["@jridgewell/trace-mapping", new Map([
    ["0.3.21", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-trace-mapping-0.3.21-5dc1df7b3dc4a6209e503a924e1ca56097a2bb15-integrity/node_modules/@jridgewell/trace-mapping/"),
      packageDependencies: new Map([
        ["@jridgewell/resolve-uri", "3.1.1"],
        ["@jridgewell/sourcemap-codec", "1.4.15"],
        ["@jridgewell/trace-mapping", "0.3.21"],
      ]),
    }],
  ])],
  ["@jridgewell/resolve-uri", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-resolve-uri-3.1.1-c08679063f279615a3326583ba3a90d1d82cc721-integrity/node_modules/@jridgewell/resolve-uri/"),
      packageDependencies: new Map([
        ["@jridgewell/resolve-uri", "3.1.1"],
      ]),
    }],
  ])],
  ["@jridgewell/sourcemap-codec", new Map([
    ["1.4.15", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-sourcemap-codec-1.4.15-d7c6e6755c78567a951e04ab52ef0fd26de59f32-integrity/node_modules/@jridgewell/sourcemap-codec/"),
      packageDependencies: new Map([
        ["@jridgewell/sourcemap-codec", "1.4.15"],
      ]),
    }],
  ])],
  ["jest-worker", new Map([
    ["27.5.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jest-worker-27.5.1-8d146f0900e8973b106b6f73cc1e9a8cb86f8db0-integrity/node_modules/jest-worker/"),
      packageDependencies: new Map([
        ["@types/node", "20.11.0"],
        ["merge-stream", "2.0.0"],
        ["supports-color", "8.1.1"],
        ["jest-worker", "27.5.1"],
      ]),
    }],
  ])],
  ["merge-stream", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/"),
      packageDependencies: new Map([
        ["merge-stream", "2.0.0"],
      ]),
    }],
  ])],
  ["serialize-javascript", new Map([
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.2-defa1e055c83bf6d59ea805d8da862254eb6a6c2-integrity/node_modules/serialize-javascript/"),
      packageDependencies: new Map([
        ["randombytes", "2.1.0"],
        ["serialize-javascript", "6.0.2"],
      ]),
    }],
    ["6.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.0-efae5d88f45d7924141da8b5c3a7a7e663fefeb8-integrity/node_modules/serialize-javascript/"),
      packageDependencies: new Map([
        ["randombytes", "2.1.0"],
        ["serialize-javascript", "6.0.0"],
      ]),
    }],
  ])],
  ["randombytes", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a-integrity/node_modules/randombytes/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
        ["randombytes", "2.1.0"],
      ]),
    }],
  ])],
  ["safe-buffer", new Map([
    ["5.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.2.1"],
      ]),
    }],
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
      ]),
    }],
  ])],
  ["terser", new Map([
    ["5.26.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-terser-5.26.0-ee9f05d929f4189a9c28a0feb889d96d50126fe1-integrity/node_modules/terser/"),
      packageDependencies: new Map([
        ["@jridgewell/source-map", "0.3.5"],
        ["acorn", "8.11.3"],
        ["commander", "2.20.3"],
        ["source-map-support", "0.5.21"],
        ["terser", "5.26.0"],
      ]),
    }],
  ])],
  ["@jridgewell/source-map", new Map([
    ["0.3.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-source-map-0.3.5-a3bb4d5c6825aab0d281268f47f6ad5853431e91-integrity/node_modules/@jridgewell/source-map/"),
      packageDependencies: new Map([
        ["@jridgewell/gen-mapping", "0.3.3"],
        ["@jridgewell/trace-mapping", "0.3.21"],
        ["@jridgewell/source-map", "0.3.5"],
      ]),
    }],
  ])],
  ["@jridgewell/gen-mapping", new Map([
    ["0.3.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-gen-mapping-0.3.3-7e02e6eb5df901aaedb08514203b096614024098-integrity/node_modules/@jridgewell/gen-mapping/"),
      packageDependencies: new Map([
        ["@jridgewell/set-array", "1.1.2"],
        ["@jridgewell/sourcemap-codec", "1.4.15"],
        ["@jridgewell/trace-mapping", "0.3.21"],
        ["@jridgewell/gen-mapping", "0.3.3"],
      ]),
    }],
  ])],
  ["@jridgewell/set-array", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-set-array-1.1.2-7c6cf998d6d20b914c0a55a91ae928ff25965e72-integrity/node_modules/@jridgewell/set-array/"),
      packageDependencies: new Map([
        ["@jridgewell/set-array", "1.1.2"],
      ]),
    }],
  ])],
  ["commander", new Map([
    ["2.20.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "2.20.3"],
      ]),
    }],
    ["10.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-commander-10.0.1-881ee46b4f77d1c1dccc5823433aa39b022cbe06-integrity/node_modules/commander/"),
      packageDependencies: new Map([
        ["commander", "10.0.1"],
      ]),
    }],
  ])],
  ["source-map-support", new Map([
    ["0.5.21", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.21-04fe7c7f9e1ed2d662233c28cb2b35b9f63f6e4f-integrity/node_modules/source-map-support/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.2"],
        ["source-map", "0.6.1"],
        ["source-map-support", "0.5.21"],
      ]),
    }],
  ])],
  ["buffer-from", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.2-2b146a6fd72e80b4f55d255f35ed59a3a9a41bd5-integrity/node_modules/buffer-from/"),
      packageDependencies: new Map([
        ["buffer-from", "1.1.2"],
      ]),
    }],
  ])],
  ["watchpack", new Map([
    ["2.4.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-watchpack-2.4.0-fa33032374962c78113f93c7f2fb4c54c9862a5d-integrity/node_modules/watchpack/"),
      packageDependencies: new Map([
        ["glob-to-regexp", "0.4.1"],
        ["graceful-fs", "4.2.11"],
        ["watchpack", "2.4.0"],
      ]),
    }],
  ])],
  ["webpack-sources", new Map([
    ["3.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-sources-3.2.3-2d4daab8451fd4b240cc27055ff6a0c2ccea0cde-integrity/node_modules/webpack-sources/"),
      packageDependencies: new Map([
        ["webpack-sources", "3.2.3"],
      ]),
    }],
  ])],
  ["webpack-cli", new Map([
    ["5.1.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-cli-5.1.4-c8e046ba7eaae4911d7e71e2b25b776fcc35759b-integrity/node_modules/webpack-cli/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@discoveryjs/json-ext", "0.5.7"],
        ["@webpack-cli/configtest", "2.1.1"],
        ["@webpack-cli/info", "2.0.2"],
        ["@webpack-cli/serve", "2.0.5"],
        ["colorette", "2.0.20"],
        ["commander", "10.0.1"],
        ["cross-spawn", "7.0.3"],
        ["envinfo", "7.11.0"],
        ["fastest-levenshtein", "1.0.16"],
        ["import-local", "3.1.0"],
        ["interpret", "3.1.1"],
        ["rechoir", "0.8.0"],
        ["webpack-merge", "5.10.0"],
        ["webpack-cli", "5.1.4"],
      ]),
    }],
  ])],
  ["@discoveryjs/json-ext", new Map([
    ["0.5.7", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@discoveryjs-json-ext-0.5.7-1d572bfbbe14b7704e0ba0f39b74815b84870d70-integrity/node_modules/@discoveryjs/json-ext/"),
      packageDependencies: new Map([
        ["@discoveryjs/json-ext", "0.5.7"],
      ]),
    }],
  ])],
  ["@webpack-cli/configtest", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-configtest-2.1.1-3b2f852e91dac6e3b85fb2a314fb8bef46d94646-integrity/node_modules/@webpack-cli/configtest/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/configtest", "2.1.1"],
      ]),
    }],
  ])],
  ["@webpack-cli/info", new Map([
    ["2.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-info-2.0.2-cc3fbf22efeb88ff62310cf885c5b09f44ae0fdd-integrity/node_modules/@webpack-cli/info/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/info", "2.0.2"],
      ]),
    }],
  ])],
  ["@webpack-cli/serve", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-serve-2.0.5-325db42395cd49fe6c14057f9a900e427df8810e-integrity/node_modules/@webpack-cli/serve/"),
      packageDependencies: new Map([
        ["webpack", "5.89.0"],
        ["@webpack-cli/serve", "2.0.5"],
      ]),
    }],
  ])],
  ["colorette", new Map([
    ["2.0.20", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-colorette-2.0.20-9eb793e6833067f7235902fcd3b09917a000a95a-integrity/node_modules/colorette/"),
      packageDependencies: new Map([
        ["colorette", "2.0.20"],
      ]),
    }],
  ])],
  ["envinfo", new Map([
    ["7.11.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-envinfo-7.11.0-c3793f44284a55ff8c82faf1ffd91bc6478ea01f-integrity/node_modules/envinfo/"),
      packageDependencies: new Map([
        ["envinfo", "7.11.0"],
      ]),
    }],
  ])],
  ["fastest-levenshtein", new Map([
    ["1.0.16", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fastest-levenshtein-1.0.16-210e61b6ff181de91ea9b3d1b84fdedd47e034e5-integrity/node_modules/fastest-levenshtein/"),
      packageDependencies: new Map([
        ["fastest-levenshtein", "1.0.16"],
      ]),
    }],
  ])],
  ["import-local", new Map([
    ["3.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-import-local-3.1.0-b4479df8a5fd44f6cdce24070675676063c95cb4-integrity/node_modules/import-local/"),
      packageDependencies: new Map([
        ["pkg-dir", "4.2.0"],
        ["resolve-cwd", "3.0.0"],
        ["import-local", "3.1.0"],
      ]),
    }],
  ])],
  ["pkg-dir", new Map([
    ["4.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3-integrity/node_modules/pkg-dir/"),
      packageDependencies: new Map([
        ["find-up", "4.1.0"],
        ["pkg-dir", "4.2.0"],
      ]),
    }],
  ])],
  ["p-try", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6-integrity/node_modules/p-try/"),
      packageDependencies: new Map([
        ["p-try", "2.2.0"],
      ]),
    }],
  ])],
  ["resolve-cwd", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d-integrity/node_modules/resolve-cwd/"),
      packageDependencies: new Map([
        ["resolve-from", "5.0.0"],
        ["resolve-cwd", "3.0.0"],
      ]),
    }],
  ])],
  ["interpret", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-interpret-3.1.1-5be0ceed67ca79c6c4bc5cf0d7ee843dcea110c4-integrity/node_modules/interpret/"),
      packageDependencies: new Map([
        ["interpret", "3.1.1"],
      ]),
    }],
  ])],
  ["rechoir", new Map([
    ["0.8.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-rechoir-0.8.0-49f866e0d32146142da3ad8f0eff352b3215ff22-integrity/node_modules/rechoir/"),
      packageDependencies: new Map([
        ["resolve", "1.22.8"],
        ["rechoir", "0.8.0"],
      ]),
    }],
  ])],
  ["resolve", new Map([
    ["1.22.8", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-1.22.8-b6c87a9f2aa06dfab52e3d70ac8cde321fa5a48d-integrity/node_modules/resolve/"),
      packageDependencies: new Map([
        ["is-core-module", "2.13.1"],
        ["path-parse", "1.0.7"],
        ["supports-preserve-symlinks-flag", "1.0.0"],
        ["resolve", "1.22.8"],
      ]),
    }],
  ])],
  ["is-core-module", new Map([
    ["2.13.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-core-module-2.13.1-ad0d7532c6fea9da1ebdc82742d74525c6273384-integrity/node_modules/is-core-module/"),
      packageDependencies: new Map([
        ["hasown", "2.0.0"],
        ["is-core-module", "2.13.1"],
      ]),
    }],
  ])],
  ["hasown", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-hasown-2.0.0-f4c513d454a57b7c7e1650778de226b11700546c-integrity/node_modules/hasown/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
        ["hasown", "2.0.0"],
      ]),
    }],
  ])],
  ["function-bind", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-function-bind-1.1.2-2c02d864d97f3ea6c8830c464cbd11ab6eab7a1c-integrity/node_modules/function-bind/"),
      packageDependencies: new Map([
        ["function-bind", "1.1.2"],
      ]),
    }],
  ])],
  ["path-parse", new Map([
    ["1.0.7", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.7-fbc114b60ca42b30d9daf5858e4bd68bbedb6735-integrity/node_modules/path-parse/"),
      packageDependencies: new Map([
        ["path-parse", "1.0.7"],
      ]),
    }],
  ])],
  ["supports-preserve-symlinks-flag", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-preserve-symlinks-flag-1.0.0-6eda4bd344a3c94aea376d4cc31bc77311039e09-integrity/node_modules/supports-preserve-symlinks-flag/"),
      packageDependencies: new Map([
        ["supports-preserve-symlinks-flag", "1.0.0"],
      ]),
    }],
  ])],
  ["webpack-merge", new Map([
    ["5.10.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-merge-5.10.0-a3ad5d773241e9c682803abf628d4cd62b8a4177-integrity/node_modules/webpack-merge/"),
      packageDependencies: new Map([
        ["clone-deep", "4.0.1"],
        ["flat", "5.0.2"],
        ["wildcard", "2.0.1"],
        ["webpack-merge", "5.10.0"],
      ]),
    }],
  ])],
  ["clone-deep", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-clone-deep-4.0.1-c19fd9bdbbf85942b4fd979c84dcf7d5f07c2387-integrity/node_modules/clone-deep/"),
      packageDependencies: new Map([
        ["is-plain-object", "2.0.4"],
        ["kind-of", "6.0.3"],
        ["shallow-clone", "3.0.1"],
        ["clone-deep", "4.0.1"],
      ]),
    }],
  ])],
  ["is-plain-object", new Map([
    ["2.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677-integrity/node_modules/is-plain-object/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
        ["is-plain-object", "2.0.4"],
      ]),
    }],
  ])],
  ["isobject", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df-integrity/node_modules/isobject/"),
      packageDependencies: new Map([
        ["isobject", "3.0.1"],
      ]),
    }],
  ])],
  ["kind-of", new Map([
    ["6.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd-integrity/node_modules/kind-of/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
      ]),
    }],
  ])],
  ["shallow-clone", new Map([
    ["3.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shallow-clone-3.0.1-8f2981ad92531f55035b01fb230769a40e02efa3-integrity/node_modules/shallow-clone/"),
      packageDependencies: new Map([
        ["kind-of", "6.0.3"],
        ["shallow-clone", "3.0.1"],
      ]),
    }],
  ])],
  ["flat", new Map([
    ["5.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flat-5.0.2-8ca6fe332069ffa9d324c327198c598259ceb241-integrity/node_modules/flat/"),
      packageDependencies: new Map([
        ["flat", "5.0.2"],
      ]),
    }],
  ])],
  ["wildcard", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wildcard-2.0.1-5ab10d02487198954836b6349f74fff961e10f67-integrity/node_modules/wildcard/"),
      packageDependencies: new Map([
        ["wildcard", "2.0.1"],
      ]),
    }],
  ])],
  ["@vscode/test-cli", new Map([
    ["0.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@vscode-test-cli-0.0.4-eeeb5620ff8b9eb31ae3e5b01af322ca68fcfaae-integrity/node_modules/@vscode/test-cli/"),
      packageDependencies: new Map([
        ["@types/mocha", "10.0.6"],
        ["chokidar", "3.5.3"],
        ["glob", "10.3.10"],
        ["minimatch", "9.0.3"],
        ["mocha", "10.2.0"],
        ["supports-color", "9.4.0"],
        ["yargs", "17.7.2"],
        ["@vscode/test-cli", "0.0.4"],
      ]),
    }],
  ])],
  ["chokidar", new Map([
    ["3.5.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chokidar-3.5.3-1cf37c8707b932bd1af1ae22c0432e2acd1903bd-integrity/node_modules/chokidar/"),
      packageDependencies: new Map([
        ["anymatch", "3.1.3"],
        ["braces", "3.0.2"],
        ["glob-parent", "5.1.2"],
        ["is-binary-path", "2.1.0"],
        ["is-glob", "4.0.3"],
        ["normalize-path", "3.0.0"],
        ["readdirp", "3.6.0"],
        ["chokidar", "3.5.3"],
      ]),
    }],
  ])],
  ["anymatch", new Map([
    ["3.1.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.3-790c58b19ba1720a84205b57c618d5ad8524973e-integrity/node_modules/anymatch/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
        ["picomatch", "2.3.1"],
        ["anymatch", "3.1.3"],
      ]),
    }],
  ])],
  ["normalize-path", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/"),
      packageDependencies: new Map([
        ["normalize-path", "3.0.0"],
      ]),
    }],
  ])],
  ["is-binary-path", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.2.0"],
        ["is-binary-path", "2.1.0"],
      ]),
    }],
  ])],
  ["binary-extensions", new Map([
    ["2.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.2.0-75f502eeaf9ffde42fc98829645be4ea76bd9e2d-integrity/node_modules/binary-extensions/"),
      packageDependencies: new Map([
        ["binary-extensions", "2.2.0"],
      ]),
    }],
  ])],
  ["readdirp", new Map([
    ["3.6.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-readdirp-3.6.0-74a370bd857116e245b29cc97340cd431a02a6c7-integrity/node_modules/readdirp/"),
      packageDependencies: new Map([
        ["picomatch", "2.3.1"],
        ["readdirp", "3.6.0"],
      ]),
    }],
  ])],
  ["foreground-child", new Map([
    ["3.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-foreground-child-3.1.1-1d173e776d75d2772fed08efe4a0de1ea1b12d0d-integrity/node_modules/foreground-child/"),
      packageDependencies: new Map([
        ["cross-spawn", "7.0.3"],
        ["signal-exit", "4.1.0"],
        ["foreground-child", "3.1.1"],
      ]),
    }],
  ])],
  ["signal-exit", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-signal-exit-4.1.0-952188c1cbd546070e2dd20d0f41c0ae0530cb04-integrity/node_modules/signal-exit/"),
      packageDependencies: new Map([
        ["signal-exit", "4.1.0"],
      ]),
    }],
  ])],
  ["jackspeak", new Map([
    ["2.3.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jackspeak-2.3.6-647ecc472238aee4b06ac0e461acc21a8c505ca8-integrity/node_modules/jackspeak/"),
      packageDependencies: new Map([
        ["@isaacs/cliui", "8.0.2"],
        ["@pkgjs/parseargs", "0.11.0"],
        ["jackspeak", "2.3.6"],
      ]),
    }],
  ])],
  ["@isaacs/cliui", new Map([
    ["8.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@isaacs-cliui-8.0.2-b37667b7bc181c168782259bab42474fbf52b550-integrity/node_modules/@isaacs/cliui/"),
      packageDependencies: new Map([
        ["string-width", "5.1.2"],
        ["string-width-cjs", "4.2.3"],
        ["strip-ansi", "7.1.0"],
        ["strip-ansi-cjs", "6.0.1"],
        ["wrap-ansi", "8.1.0"],
        ["wrap-ansi-cjs", "7.0.0"],
        ["@isaacs/cliui", "8.0.2"],
      ]),
    }],
  ])],
  ["string-width", new Map([
    ["5.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-5.1.2-14f8daec6d81e7221d2a357e668cab73bdbca794-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["eastasianwidth", "0.2.0"],
        ["emoji-regex", "9.2.2"],
        ["strip-ansi", "7.1.0"],
        ["string-width", "5.1.2"],
      ]),
    }],
    ["4.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-4.2.3-269c7117d27b05ad2e536830a8ec895ef9c6d010-integrity/node_modules/string-width/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
        ["is-fullwidth-code-point", "3.0.0"],
        ["strip-ansi", "6.0.1"],
        ["string-width", "4.2.3"],
      ]),
    }],
  ])],
  ["eastasianwidth", new Map([
    ["0.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eastasianwidth-0.2.0-696ce2ec0aa0e6ea93a397ffcf24aa7840c827cb-integrity/node_modules/eastasianwidth/"),
      packageDependencies: new Map([
        ["eastasianwidth", "0.2.0"],
      ]),
    }],
  ])],
  ["emoji-regex", new Map([
    ["9.2.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-emoji-regex-9.2.2-840c8803b0d8047f4ff0cf963176b32d4ef3ed72-integrity/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "9.2.2"],
      ]),
    }],
    ["8.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37-integrity/node_modules/emoji-regex/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
      ]),
    }],
  ])],
  ["string-width-cjs", new Map([
    ["4.2.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-cjs-4.2.3-269c7117d27b05ad2e536830a8ec895ef9c6d010-integrity/node_modules/string-width-cjs/"),
      packageDependencies: new Map([
        ["emoji-regex", "8.0.0"],
        ["is-fullwidth-code-point", "3.0.0"],
        ["strip-ansi", "6.0.1"],
        ["string-width-cjs", "4.2.3"],
      ]),
    }],
  ])],
  ["is-fullwidth-code-point", new Map([
    ["3.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d-integrity/node_modules/is-fullwidth-code-point/"),
      packageDependencies: new Map([
        ["is-fullwidth-code-point", "3.0.0"],
      ]),
    }],
  ])],
  ["strip-ansi-cjs", new Map([
    ["6.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-cjs-6.0.1-9e26c63d30f53443e9489495b2105d37b67a85d9-integrity/node_modules/strip-ansi-cjs/"),
      packageDependencies: new Map([
        ["ansi-regex", "5.0.1"],
        ["strip-ansi-cjs", "6.0.1"],
      ]),
    }],
  ])],
  ["wrap-ansi", new Map([
    ["8.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-8.1.0-56dc22368ee570face1b49819975d9b9a5ead214-integrity/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "6.2.1"],
        ["string-width", "5.1.2"],
        ["strip-ansi", "7.1.0"],
        ["wrap-ansi", "8.1.0"],
      ]),
    }],
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-7.0.0-67e145cff510a6a6984bdf1152911d69d2eb9e43-integrity/node_modules/wrap-ansi/"),
      packageDependencies: new Map([
        ["ansi-styles", "4.3.0"],
        ["string-width", "4.2.3"],
        ["strip-ansi", "6.0.1"],
        ["wrap-ansi", "7.0.0"],
      ]),
    }],
  ])],
  ["wrap-ansi-cjs", new Map([
    ["7.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-cjs-7.0.0-67e145cff510a6a6984bdf1152911d69d2eb9e43-integrity/node_modules/wrap-ansi-cjs/"),
      packageDependencies: new Map([
        ["ansi-styles", "4.3.0"],
        ["string-width", "4.2.3"],
        ["strip-ansi", "6.0.1"],
        ["wrap-ansi-cjs", "7.0.0"],
      ]),
    }],
  ])],
  ["@pkgjs/parseargs", new Map([
    ["0.11.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@pkgjs-parseargs-0.11.0-a77ea742fab25775145434eb1d2328cf5013ac33-integrity/node_modules/@pkgjs/parseargs/"),
      packageDependencies: new Map([
        ["@pkgjs/parseargs", "0.11.0"],
      ]),
    }],
  ])],
  ["minipass", new Map([
    ["7.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minipass-7.0.4-dbce03740f50a4786ba994c1fb908844d27b038c-integrity/node_modules/minipass/"),
      packageDependencies: new Map([
        ["minipass", "7.0.4"],
      ]),
    }],
  ])],
  ["path-scurry", new Map([
    ["1.10.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-scurry-1.10.1-9ba6bf5aa8500fe9fd67df4f0d9483b2b0bfc698-integrity/node_modules/path-scurry/"),
      packageDependencies: new Map([
        ["lru-cache", "10.1.0"],
        ["minipass", "7.0.4"],
        ["path-scurry", "1.10.1"],
      ]),
    }],
  ])],
  ["mocha", new Map([
    ["10.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mocha-10.2.0-1fd4a7c32ba5ac372e03a17eef435bd00e5c68b8-integrity/node_modules/mocha/"),
      packageDependencies: new Map([
        ["ansi-colors", "4.1.1"],
        ["browser-stdout", "1.3.1"],
        ["chokidar", "3.5.3"],
        ["debug", "4.3.4"],
        ["diff", "5.0.0"],
        ["escape-string-regexp", "4.0.0"],
        ["find-up", "5.0.0"],
        ["glob", "7.2.0"],
        ["he", "1.2.0"],
        ["js-yaml", "4.1.0"],
        ["log-symbols", "4.1.0"],
        ["minimatch", "5.0.1"],
        ["ms", "2.1.3"],
        ["nanoid", "3.3.3"],
        ["serialize-javascript", "6.0.0"],
        ["strip-json-comments", "3.1.1"],
        ["supports-color", "8.1.1"],
        ["workerpool", "6.2.1"],
        ["yargs", "16.2.0"],
        ["yargs-parser", "20.2.4"],
        ["yargs-unparser", "2.0.0"],
        ["mocha", "10.2.0"],
      ]),
    }],
  ])],
  ["ansi-colors", new Map([
    ["4.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-colors-4.1.1-cbb9ae256bf750af1eab344f229aa27fe94ba348-integrity/node_modules/ansi-colors/"),
      packageDependencies: new Map([
        ["ansi-colors", "4.1.1"],
      ]),
    }],
  ])],
  ["browser-stdout", new Map([
    ["1.3.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-browser-stdout-1.3.1-baa559ee14ced73452229bad7326467c61fabd60-integrity/node_modules/browser-stdout/"),
      packageDependencies: new Map([
        ["browser-stdout", "1.3.1"],
      ]),
    }],
  ])],
  ["diff", new Map([
    ["5.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-diff-5.0.0-7ed6ad76d859d030787ec35855f5b1daf31d852b-integrity/node_modules/diff/"),
      packageDependencies: new Map([
        ["diff", "5.0.0"],
      ]),
    }],
  ])],
  ["he", new Map([
    ["1.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-he-1.2.0-84ae65fa7eafb165fddb61566ae14baf05664f0f-integrity/node_modules/he/"),
      packageDependencies: new Map([
        ["he", "1.2.0"],
      ]),
    }],
  ])],
  ["log-symbols", new Map([
    ["4.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-log-symbols-4.1.0-3fbdbb95b4683ac9fc785111e792e558d4abd503-integrity/node_modules/log-symbols/"),
      packageDependencies: new Map([
        ["chalk", "4.1.2"],
        ["is-unicode-supported", "0.1.0"],
        ["log-symbols", "4.1.0"],
      ]),
    }],
  ])],
  ["is-unicode-supported", new Map([
    ["0.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-unicode-supported-0.1.0-3f26c76a809593b52bfa2ecb5710ed2779b522a7-integrity/node_modules/is-unicode-supported/"),
      packageDependencies: new Map([
        ["is-unicode-supported", "0.1.0"],
      ]),
    }],
  ])],
  ["nanoid", new Map([
    ["3.3.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-nanoid-3.3.3-fd8e8b7aa761fe807dba2d1b98fb7241bb724a25-integrity/node_modules/nanoid/"),
      packageDependencies: new Map([
        ["nanoid", "3.3.3"],
      ]),
    }],
  ])],
  ["workerpool", new Map([
    ["6.2.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-workerpool-6.2.1-46fc150c17d826b86a008e5a4508656777e9c343-integrity/node_modules/workerpool/"),
      packageDependencies: new Map([
        ["workerpool", "6.2.1"],
      ]),
    }],
  ])],
  ["yargs", new Map([
    ["16.2.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-16.2.0-1c82bf0f6b6a66eafce7ef30e376f49a12477f66-integrity/node_modules/yargs/"),
      packageDependencies: new Map([
        ["cliui", "7.0.4"],
        ["escalade", "3.1.1"],
        ["get-caller-file", "2.0.5"],
        ["require-directory", "2.1.1"],
        ["string-width", "4.2.3"],
        ["y18n", "5.0.8"],
        ["yargs-parser", "20.2.9"],
        ["yargs", "16.2.0"],
      ]),
    }],
    ["17.7.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-17.7.2-991df39aca675a192b816e1e0363f9d75d2aa269-integrity/node_modules/yargs/"),
      packageDependencies: new Map([
        ["cliui", "8.0.1"],
        ["escalade", "3.1.1"],
        ["get-caller-file", "2.0.5"],
        ["require-directory", "2.1.1"],
        ["string-width", "4.2.3"],
        ["y18n", "5.0.8"],
        ["yargs-parser", "21.1.1"],
        ["yargs", "17.7.2"],
      ]),
    }],
  ])],
  ["cliui", new Map([
    ["7.0.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cliui-7.0.4-a0265ee655476fc807aea9df3df8df7783808b4f-integrity/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "4.2.3"],
        ["strip-ansi", "6.0.1"],
        ["wrap-ansi", "7.0.0"],
        ["cliui", "7.0.4"],
      ]),
    }],
    ["8.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cliui-8.0.1-0c04b075db02cbfe60dc8e6cf2f5486b1a3608aa-integrity/node_modules/cliui/"),
      packageDependencies: new Map([
        ["string-width", "4.2.3"],
        ["strip-ansi", "6.0.1"],
        ["wrap-ansi", "7.0.0"],
        ["cliui", "8.0.1"],
      ]),
    }],
  ])],
  ["get-caller-file", new Map([
    ["2.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-get-caller-file-2.0.5-4f94412a82db32f36e3b0b9741f8a97feb031f7e-integrity/node_modules/get-caller-file/"),
      packageDependencies: new Map([
        ["get-caller-file", "2.0.5"],
      ]),
    }],
  ])],
  ["require-directory", new Map([
    ["2.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42-integrity/node_modules/require-directory/"),
      packageDependencies: new Map([
        ["require-directory", "2.1.1"],
      ]),
    }],
  ])],
  ["y18n", new Map([
    ["5.0.8", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-y18n-5.0.8-7f4934d0f7ca8c56f95314939ddcd2dd91ce1d55-integrity/node_modules/y18n/"),
      packageDependencies: new Map([
        ["y18n", "5.0.8"],
      ]),
    }],
  ])],
  ["yargs-parser", new Map([
    ["20.2.9", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-20.2.9-2eb7dc3b0289718fc295f362753845c41a0c94ee-integrity/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["yargs-parser", "20.2.9"],
      ]),
    }],
    ["20.2.4", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-20.2.4-b42890f14566796f85ae8e3a25290d205f154a54-integrity/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["yargs-parser", "20.2.4"],
      ]),
    }],
    ["21.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-21.1.1-9096bceebf990d21bb31fa9516e0ede294a77d35-integrity/node_modules/yargs-parser/"),
      packageDependencies: new Map([
        ["yargs-parser", "21.1.1"],
      ]),
    }],
  ])],
  ["yargs-unparser", new Map([
    ["2.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-unparser-2.0.0-f131f9226911ae5d9ad38c432fe809366c2325eb-integrity/node_modules/yargs-unparser/"),
      packageDependencies: new Map([
        ["camelcase", "6.3.0"],
        ["decamelize", "4.0.0"],
        ["flat", "5.0.2"],
        ["is-plain-obj", "2.1.0"],
        ["yargs-unparser", "2.0.0"],
      ]),
    }],
  ])],
  ["camelcase", new Map([
    ["6.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-camelcase-6.3.0-5685b95eb209ac9c0c177467778c9c84df58ba9a-integrity/node_modules/camelcase/"),
      packageDependencies: new Map([
        ["camelcase", "6.3.0"],
      ]),
    }],
  ])],
  ["decamelize", new Map([
    ["4.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-decamelize-4.0.0-aa472d7bf660eb15f3494efd531cab7f2a709837-integrity/node_modules/decamelize/"),
      packageDependencies: new Map([
        ["decamelize", "4.0.0"],
      ]),
    }],
  ])],
  ["is-plain-obj", new Map([
    ["2.1.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-plain-obj-2.1.0-45e42e37fccf1f40da8e5f76ee21515840c09287-integrity/node_modules/is-plain-obj/"),
      packageDependencies: new Map([
        ["is-plain-obj", "2.1.0"],
      ]),
    }],
  ])],
  ["@vscode/test-electron", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@vscode-test-electron-2.3.8-06a7c50b38cfac0ede833905e088d55c61cd12d3-integrity/node_modules/@vscode/test-electron/"),
      packageDependencies: new Map([
        ["http-proxy-agent", "4.0.1"],
        ["https-proxy-agent", "5.0.1"],
        ["jszip", "3.10.1"],
        ["semver", "7.5.4"],
        ["@vscode/test-electron", "2.3.8"],
      ]),
    }],
  ])],
  ["http-proxy-agent", new Map([
    ["4.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-http-proxy-agent-4.0.1-8a8c8ef7f5932ccf953c296ca8291b95aa74aa3a-integrity/node_modules/http-proxy-agent/"),
      packageDependencies: new Map([
        ["@tootallnate/once", "1.1.2"],
        ["agent-base", "6.0.2"],
        ["debug", "4.3.4"],
        ["http-proxy-agent", "4.0.1"],
      ]),
    }],
  ])],
  ["@tootallnate/once", new Map([
    ["1.1.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@tootallnate-once-1.1.2-ccb91445360179a04e7fe6aff78c00ffc1eeaf82-integrity/node_modules/@tootallnate/once/"),
      packageDependencies: new Map([
        ["@tootallnate/once", "1.1.2"],
      ]),
    }],
  ])],
  ["agent-base", new Map([
    ["6.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-agent-base-6.0.2-49fff58577cfee3f37176feab4c22e00f86d7f77-integrity/node_modules/agent-base/"),
      packageDependencies: new Map([
        ["debug", "4.3.4"],
        ["agent-base", "6.0.2"],
      ]),
    }],
  ])],
  ["https-proxy-agent", new Map([
    ["5.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-https-proxy-agent-5.0.1-c59ef224a04fe8b754f3db0063a25ea30d0005d6-integrity/node_modules/https-proxy-agent/"),
      packageDependencies: new Map([
        ["agent-base", "6.0.2"],
        ["debug", "4.3.4"],
        ["https-proxy-agent", "5.0.1"],
      ]),
    }],
  ])],
  ["jszip", new Map([
    ["3.10.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jszip-3.10.1-34aee70eb18ea1faec2f589208a157d1feb091c2-integrity/node_modules/jszip/"),
      packageDependencies: new Map([
        ["lie", "3.3.0"],
        ["pako", "1.0.11"],
        ["readable-stream", "2.3.8"],
        ["setimmediate", "1.0.5"],
        ["jszip", "3.10.1"],
      ]),
    }],
  ])],
  ["lie", new Map([
    ["3.3.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lie-3.3.0-dcf82dee545f46074daf200c7c1c5a08e0f40f6a-integrity/node_modules/lie/"),
      packageDependencies: new Map([
        ["immediate", "3.0.6"],
        ["lie", "3.3.0"],
      ]),
    }],
  ])],
  ["immediate", new Map([
    ["3.0.6", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-immediate-3.0.6-9db1dbd0faf8de6fbe0f5dd5e56bb606280de69b-integrity/node_modules/immediate/"),
      packageDependencies: new Map([
        ["immediate", "3.0.6"],
      ]),
    }],
  ])],
  ["pako", new Map([
    ["1.0.11", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-pako-1.0.11-6c9599d340d54dfd3946380252a35705a6b992bf-integrity/node_modules/pako/"),
      packageDependencies: new Map([
        ["pako", "1.0.11"],
      ]),
    }],
  ])],
  ["readable-stream", new Map([
    ["2.3.8", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-readable-stream-2.3.8-91125e8042bba1b9887f49345f6277027ce8be9b-integrity/node_modules/readable-stream/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.3"],
        ["inherits", "2.0.4"],
        ["isarray", "1.0.0"],
        ["process-nextick-args", "2.0.1"],
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
        ["util-deprecate", "1.0.2"],
        ["readable-stream", "2.3.8"],
      ]),
    }],
  ])],
  ["core-util-is", new Map([
    ["1.0.3", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-core-util-is-1.0.3-a6042d3634c2b27e9328f837b965fac83808db85-integrity/node_modules/core-util-is/"),
      packageDependencies: new Map([
        ["core-util-is", "1.0.3"],
      ]),
    }],
  ])],
  ["isarray", new Map([
    ["1.0.0", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/"),
      packageDependencies: new Map([
        ["isarray", "1.0.0"],
      ]),
    }],
  ])],
  ["process-nextick-args", new Map([
    ["2.0.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/"),
      packageDependencies: new Map([
        ["process-nextick-args", "2.0.1"],
      ]),
    }],
  ])],
  ["string_decoder", new Map([
    ["1.1.1", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/"),
      packageDependencies: new Map([
        ["safe-buffer", "5.1.2"],
        ["string_decoder", "1.1.1"],
      ]),
    }],
  ])],
  ["util-deprecate", new Map([
    ["1.0.2", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/"),
      packageDependencies: new Map([
        ["util-deprecate", "1.0.2"],
      ]),
    }],
  ])],
  ["setimmediate", new Map([
    ["1.0.5", {
      packageLocation: path.resolve(__dirname, "../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-setimmediate-1.0.5-290cbb232e306942d7d7ea9b83732ab7856f8285-integrity/node_modules/setimmediate/"),
      packageDependencies: new Map([
        ["setimmediate", "1.0.5"],
      ]),
    }],
  ])],
  [null, new Map([
    [null, {
      packageLocation: path.resolve(__dirname, "./"),
      packageDependencies: new Map([
        ["@types/vscode", "1.85.0"],
        ["@types/mocha", "10.0.6"],
        ["@types/node", "18.19.6"],
        ["@typescript-eslint/eslint-plugin", "6.18.1"],
        ["@typescript-eslint/parser", "6.18.1"],
        ["eslint", "8.56.0"],
        ["typescript", "5.3.3"],
        ["ts-loader", "9.5.1"],
        ["webpack", "5.89.0"],
        ["webpack-cli", "5.1.4"],
        ["@vscode/test-cli", "0.0.4"],
        ["@vscode/test-electron", "2.3.8"],
      ]),
    }],
  ])],
]);

let locatorsByLocations = new Map([
  ["./.pnp/externals/pnp-3851833313f298925628c478ff14362db2969afa/node_modules/@typescript-eslint/utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-fce83a8e30ba70dd02ed63cd29dfa147c906a9d0/node_modules/ts-api-utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-e78b389baa7bb97685bfb09f59e5816508cb0477/node_modules/@typescript-eslint/utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-f90bd8b9970dccc3377f1e25e890ae13f86f6648/node_modules/ts-api-utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-08204628e14a1729bd7126b0f35259578570767a/node_modules/ts-api-utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-80f148d45a63cebd125171d989cc241a69688d73/node_modules/@eslint-community/eslint-utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-875c92d0e85d32aa44c189c39f594b09874ba086/node_modules/@eslint-community/eslint-utils/", blacklistedLocator],
  ["./.pnp/externals/pnp-28dd33d556be69170756af69e72c88a7b9602f0a/node_modules/@eslint-community/eslint-utils/", blacklistedLocator],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-vscode-1.85.0-46beb07f0f626665b52d1e2294382b2bc63b602e-integrity/node_modules/@types/vscode/", {"name":"@types/vscode","reference":"1.85.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-mocha-10.0.6-818551d39113081048bdddbef96701b4e8bb9d1b-integrity/node_modules/@types/mocha/", {"name":"@types/mocha","reference":"10.0.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-node-18.19.6-537beece2c8ad4d9abdaa3b0f428e601eb57dac8-integrity/node_modules/@types/node/", {"name":"@types/node","reference":"18.19.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-node-20.11.0-8e0b99e70c0c1ade1a86c4a282f7b7ef87c9552f-integrity/node_modules/@types/node/", {"name":"@types/node","reference":"20.11.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-undici-types-5.26.5-bcd539893d00b56e964fd2657a4866b221a65617-integrity/node_modules/undici-types/", {"name":"undici-types","reference":"5.26.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-eslint-plugin-6.18.1-0df881a47da1c1a9774f39495f5f7052f86b72e0-integrity/node_modules/@typescript-eslint/eslint-plugin/", {"name":"@typescript-eslint/eslint-plugin","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-community-regexpp-4.10.0-548f6de556857c8bb73bbee70c35dc82a2e74d63-integrity/node_modules/@eslint-community/regexpp/", {"name":"@eslint-community/regexpp","reference":"4.10.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-scope-manager-6.18.1-28c31c60f6e5827996aa3560a538693cb4bd3848-integrity/node_modules/@typescript-eslint/scope-manager/", {"name":"@typescript-eslint/scope-manager","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-types-6.18.1-91617d8080bcd99ac355d9157079970d1d49fefc-integrity/node_modules/@typescript-eslint/types/", {"name":"@typescript-eslint/types","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-visitor-keys-6.18.1-704d789bda2565a15475e7d22f145b8fe77443f4-integrity/node_modules/@typescript-eslint/visitor-keys/", {"name":"@typescript-eslint/visitor-keys","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-visitor-keys-3.4.3-0cd72fe8550e3c2eae156a96a4dddcd1c8ac5800-integrity/node_modules/eslint-visitor-keys/", {"name":"eslint-visitor-keys","reference":"3.4.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-type-utils-6.18.1-115cf535f8b39db8301677199ce51151e2daee96-integrity/node_modules/@typescript-eslint/type-utils/", {"name":"@typescript-eslint/type-utils","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-typescript-estree-6.18.1-a12b6440175b4cbc9d09ab3c4966c6b245215ab4-integrity/node_modules/@typescript-eslint/typescript-estree/", {"name":"@typescript-eslint/typescript-estree","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-debug-4.3.4-1319f6579357f2338d3337d2cdd4914bb5dcc865-integrity/node_modules/debug/", {"name":"debug","reference":"4.3.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ms-2.1.2-d09d1f357b443f493382a8eb3ccd183872ae6009-integrity/node_modules/ms/", {"name":"ms","reference":"2.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ms-2.1.3-574c8138ce1d2b5861f0b44579dbadd60c6615b2-integrity/node_modules/ms/", {"name":"ms","reference":"2.1.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-globby-11.1.0-bd4be98bb042f83d796f7e3811991fbe82a0d34b-integrity/node_modules/globby/", {"name":"globby","reference":"11.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-array-union-2.1.0-b798420adbeb1de828d84acd8a2e23d3efe85e8d-integrity/node_modules/array-union/", {"name":"array-union","reference":"2.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-dir-glob-3.0.1-56dbf73d992a4a93ba1584f4534063fd2e41717f-integrity/node_modules/dir-glob/", {"name":"dir-glob","reference":"3.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-type-4.0.0-84ed01c0a7ba380afe09d90a8c180dcd9d03043b-integrity/node_modules/path-type/", {"name":"path-type","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-glob-3.3.2-a904501e57cfdd2ffcded45e99a54fef55e46129-integrity/node_modules/fast-glob/", {"name":"fast-glob","reference":"3.3.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-stat-2.0.5-5bd262af94e9d25bd1e71b05deed44876a222e8b-integrity/node_modules/@nodelib/fs.stat/", {"name":"@nodelib/fs.stat","reference":"2.0.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-walk-1.2.8-e95737e8bb6746ddedf69c556953494f196fe69a-integrity/node_modules/@nodelib/fs.walk/", {"name":"@nodelib/fs.walk","reference":"1.2.8"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@nodelib-fs-scandir-2.1.5-7619c2eb21b25483f6d167548b4cfd5a7488c3d5-integrity/node_modules/@nodelib/fs.scandir/", {"name":"@nodelib/fs.scandir","reference":"2.1.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-run-parallel-1.2.0-66d1368da7bdf921eb9d95bd1a9229e7f21a43ee-integrity/node_modules/run-parallel/", {"name":"run-parallel","reference":"1.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-queue-microtask-1.2.3-4929228bbc724dfac43e0efb058caf7b6cfb6243-integrity/node_modules/queue-microtask/", {"name":"queue-microtask","reference":"1.2.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fastq-1.16.0-83b9a9375692db77a822df081edb6a9cf6839320-integrity/node_modules/fastq/", {"name":"fastq","reference":"1.16.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-reusify-1.0.4-90da382b1e126efc02146e90845a88db12925d76-integrity/node_modules/reusify/", {"name":"reusify","reference":"1.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-parent-5.1.2-869832c58034fe68a4093c17dc15e8340d8401c4-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"5.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-parent-6.0.2-6d237d99083950c79290f24c7642a3de9a28f9e3-integrity/node_modules/glob-parent/", {"name":"glob-parent","reference":"6.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-glob-4.0.3-64f61e42cbbb2eec2071a9dac0b28ba1e65d5084-integrity/node_modules/is-glob/", {"name":"is-glob","reference":"4.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-extglob-2.1.1-a88c02535791f02ed37c76a1b9ea9773c833f8c2-integrity/node_modules/is-extglob/", {"name":"is-extglob","reference":"2.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-merge2-1.4.1-4368892f885e907455a6fd7dc55c0c9d404990ae-integrity/node_modules/merge2/", {"name":"merge2","reference":"1.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-micromatch-4.0.5-bc8999a7cbbf77cdc89f132f6e467051b49090c6-integrity/node_modules/micromatch/", {"name":"micromatch","reference":"4.0.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-braces-3.0.2-3454e1a462ee8d599e236df336cd9ea4f8afe107-integrity/node_modules/braces/", {"name":"braces","reference":"3.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fill-range-7.0.1-1919a6a7c75fe38b2c7c77e5198535da9acdda40-integrity/node_modules/fill-range/", {"name":"fill-range","reference":"7.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-to-regex-range-5.0.1-1648c44aae7c8d988a326018ed72f5b4dd0392e4-integrity/node_modules/to-regex-range/", {"name":"to-regex-range","reference":"5.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-number-7.0.0-7535345b896734d5f80c4d06c50955527a14f12b-integrity/node_modules/is-number/", {"name":"is-number","reference":"7.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-picomatch-2.3.1-3ba3833733646d9d3e4995946c1365a67fb07a42-integrity/node_modules/picomatch/", {"name":"picomatch","reference":"2.3.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ignore-5.3.0-67418ae40d34d6999c95ff56016759c718c82f78-integrity/node_modules/ignore/", {"name":"ignore","reference":"5.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-slash-3.0.0-6539be870c165adbd5240220dbe361f1bc4d4634-integrity/node_modules/slash/", {"name":"slash","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-9.0.3-a6e00c3de44c3a542bfaae70abfc22420a6da825-integrity/node_modules/minimatch/", {"name":"minimatch","reference":"9.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-3.1.2-19cd194bfd3e428f049a70817c038d89ab4be35b-integrity/node_modules/minimatch/", {"name":"minimatch","reference":"3.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minimatch-5.0.1-fb9022f7528125187c92bd9e9b6366be1cf3415b-integrity/node_modules/minimatch/", {"name":"minimatch","reference":"5.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-brace-expansion-2.0.1-1edc459e0f0c548486ecf9fc99f2221364b9a0ae-integrity/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"2.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-brace-expansion-1.1.11-3c7fcbf529d87226f3d2f52b966ff5271eb441dd-integrity/node_modules/brace-expansion/", {"name":"brace-expansion","reference":"1.1.11"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-balanced-match-1.0.2-e83e3a7e3f300b34cb9d87f615fa0cbf357690ee-integrity/node_modules/balanced-match/", {"name":"balanced-match","reference":"1.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-semver-7.5.4-483986ec4ed38e1c6c48c34894a9182dbff68a6e-integrity/node_modules/semver/", {"name":"semver","reference":"7.5.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lru-cache-6.0.0-6d6fe6570ebd96aaf90fcad1dafa3b2566db3a94-integrity/node_modules/lru-cache/", {"name":"lru-cache","reference":"6.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lru-cache-10.1.0-2098d41c2dc56500e6c88584aa656c84de7d0484-integrity/node_modules/lru-cache/", {"name":"lru-cache","reference":"10.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yallist-4.0.0-9bb92790d9c0effec63be73519e11a35019a3a72-integrity/node_modules/yallist/", {"name":"yallist","reference":"4.0.0"}],
  ["./.pnp/externals/pnp-08204628e14a1729bd7126b0f35259578570767a/node_modules/ts-api-utils/", {"name":"ts-api-utils","reference":"pnp:08204628e14a1729bd7126b0f35259578570767a"}],
  ["./.pnp/externals/pnp-f90bd8b9970dccc3377f1e25e890ae13f86f6648/node_modules/ts-api-utils/", {"name":"ts-api-utils","reference":"pnp:f90bd8b9970dccc3377f1e25e890ae13f86f6648"}],
  ["./.pnp/externals/pnp-fce83a8e30ba70dd02ed63cd29dfa147c906a9d0/node_modules/ts-api-utils/", {"name":"ts-api-utils","reference":"pnp:fce83a8e30ba70dd02ed63cd29dfa147c906a9d0"}],
  ["./.pnp/externals/pnp-e78b389baa7bb97685bfb09f59e5816508cb0477/node_modules/@typescript-eslint/utils/", {"name":"@typescript-eslint/utils","reference":"pnp:e78b389baa7bb97685bfb09f59e5816508cb0477"}],
  ["./.pnp/externals/pnp-3851833313f298925628c478ff14362db2969afa/node_modules/@typescript-eslint/utils/", {"name":"@typescript-eslint/utils","reference":"pnp:3851833313f298925628c478ff14362db2969afa"}],
  ["./.pnp/externals/pnp-80f148d45a63cebd125171d989cc241a69688d73/node_modules/@eslint-community/eslint-utils/", {"name":"@eslint-community/eslint-utils","reference":"pnp:80f148d45a63cebd125171d989cc241a69688d73"}],
  ["./.pnp/externals/pnp-875c92d0e85d32aa44c189c39f594b09874ba086/node_modules/@eslint-community/eslint-utils/", {"name":"@eslint-community/eslint-utils","reference":"pnp:875c92d0e85d32aa44c189c39f594b09874ba086"}],
  ["./.pnp/externals/pnp-28dd33d556be69170756af69e72c88a7b9602f0a/node_modules/@eslint-community/eslint-utils/", {"name":"@eslint-community/eslint-utils","reference":"pnp:28dd33d556be69170756af69e72c88a7b9602f0a"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-json-schema-7.0.15-596a1747233694d50f6ad8a7869fcb6f56cf5841-integrity/node_modules/@types/json-schema/", {"name":"@types/json-schema","reference":"7.0.15"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-semver-7.5.6-c65b2bfce1bec346582c07724e3f8c1017a20339-integrity/node_modules/@types/semver/", {"name":"@types/semver","reference":"7.5.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-graphemer-1.4.0-fb2f1d55e0e3a1849aeffc90c4fa0dd53a0e66c6-integrity/node_modules/graphemer/", {"name":"graphemer","reference":"1.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-natural-compare-1.4.0-4abebfeed7541f2c27acfb29bdbbd15c8d5ba4f7-integrity/node_modules/natural-compare/", {"name":"natural-compare","reference":"1.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@typescript-eslint-parser-6.18.1-3c3987e186b38c77b30b6bfa5edf7c98ae2ec9d3-integrity/node_modules/@typescript-eslint/parser/", {"name":"@typescript-eslint/parser","reference":"6.18.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-8.56.0-4957ce8da409dc0809f99ab07a1b94832ab74b15-integrity/node_modules/eslint/", {"name":"eslint","reference":"8.56.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-eslintrc-2.1.4-388a269f0f25c1b6adc317b5a2c55714894c70ad-integrity/node_modules/@eslint/eslintrc/", {"name":"@eslint/eslintrc","reference":"2.1.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ajv-6.12.6-baf5a62e802b07d977034586f8c3baf5adf26df4-integrity/node_modules/ajv/", {"name":"ajv","reference":"6.12.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-deep-equal-3.1.3-3a7d56b559d6cbc3eb512325244e619a65c6c525-integrity/node_modules/fast-deep-equal/", {"name":"fast-deep-equal","reference":"3.1.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-json-stable-stringify-2.1.0-874bf69c6f404c2b5d99c481341399fd55892633-integrity/node_modules/fast-json-stable-stringify/", {"name":"fast-json-stable-stringify","reference":"2.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-schema-traverse-0.4.1-69f6a87d9513ab8bb8fe63bdb0979c448e684660-integrity/node_modules/json-schema-traverse/", {"name":"json-schema-traverse","reference":"0.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-uri-js-4.4.1-9b1a52595225859e55f669d928f88c6c57f2a77e-integrity/node_modules/uri-js/", {"name":"uri-js","reference":"4.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-punycode-2.3.1-027422e2faec0b25e1549c3e1bd8309b9133b6e5-integrity/node_modules/punycode/", {"name":"punycode","reference":"2.3.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-espree-9.6.1-a2a17b8e434690a5432f2f8018ce71d331a48c6f-integrity/node_modules/espree/", {"name":"espree","reference":"9.6.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-8.11.3-71e0b14e13a4ec160724b38fb7b0f233b1b81d7a-integrity/node_modules/acorn/", {"name":"acorn","reference":"8.11.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-jsx-5.3.2-7ed5bb55908b3b2f1bc55c6af1653bada7f07937-integrity/node_modules/acorn-jsx/", {"name":"acorn-jsx","reference":"5.3.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-globals-13.24.0-8432a19d78ce0c1e833949c36adb345400bb1171-integrity/node_modules/globals/", {"name":"globals","reference":"13.24.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-type-fest-0.20.2-1bf207f4b28f91583666cb5fbd327887301cd5f4-integrity/node_modules/type-fest/", {"name":"type-fest","reference":"0.20.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-import-fresh-3.3.0-37162c25fcb9ebaa2e6e53d5b4d88ce17d9e0c2b-integrity/node_modules/import-fresh/", {"name":"import-fresh","reference":"3.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-parent-module-1.0.1-691d2709e78c79fae3a156622452d00762caaaa2-integrity/node_modules/parent-module/", {"name":"parent-module","reference":"1.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-callsites-3.1.0-b3630abd8943432f54b3f0519238e33cd7df2f73-integrity/node_modules/callsites/", {"name":"callsites","reference":"3.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-from-4.0.0-4abcd852ad32dd7baabfe9b40e00a36db5f392e6-integrity/node_modules/resolve-from/", {"name":"resolve-from","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-from-5.0.0-c35225843df8f776df21c57557bc087e9dfdfc69-integrity/node_modules/resolve-from/", {"name":"resolve-from","reference":"5.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-js-yaml-4.1.0-c1fb65f8f5017901cdd2c951864ba18458a10602-integrity/node_modules/js-yaml/", {"name":"js-yaml","reference":"4.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-argparse-2.0.1-246f50f3ca78a3240f6c997e8a9bd1eac49e4b38-integrity/node_modules/argparse/", {"name":"argparse","reference":"2.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-concat-map-0.0.1-d8a96bd77fd68df7793a73036a3ba0d5405d477b-integrity/node_modules/concat-map/", {"name":"concat-map","reference":"0.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-json-comments-3.1.1-31f1281b3832630434831c310c01cccda8cbe006-integrity/node_modules/strip-json-comments/", {"name":"strip-json-comments","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@eslint-js-8.56.0-ef20350fec605a7f7035a01764731b2de0f3782b-integrity/node_modules/@eslint/js/", {"name":"@eslint/js","reference":"8.56.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-config-array-0.11.14-d78e481a039f7566ecc9660b4ea7fe6b1fec442b-integrity/node_modules/@humanwhocodes/config-array/", {"name":"@humanwhocodes/config-array","reference":"0.11.14"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-object-schema-2.0.2-d9fae00a2d5cb40f92cfe64b47ad749fbc38f917-integrity/node_modules/@humanwhocodes/object-schema/", {"name":"@humanwhocodes/object-schema","reference":"2.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@humanwhocodes-module-importer-1.0.1-af5b2691a22b44be847b0ca81641c5fb6ad0172c-integrity/node_modules/@humanwhocodes/module-importer/", {"name":"@humanwhocodes/module-importer","reference":"1.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@ungap-structured-clone-1.2.0-756641adb587851b5ccb3e095daf27ae581c8406-integrity/node_modules/@ungap/structured-clone/", {"name":"@ungap/structured-clone","reference":"1.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chalk-4.1.2-aac4e2b7734a740867aeb16bf02aad556a1e7a01-integrity/node_modules/chalk/", {"name":"chalk","reference":"4.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-styles-4.3.0-edd803628ae71c04c85ae7a0906edad34b648937-integrity/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"4.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-styles-6.2.1-0e62320cf99c21afff3b3012192546aacbfb05c5-integrity/node_modules/ansi-styles/", {"name":"ansi-styles","reference":"6.2.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-color-convert-2.0.1-72d3a68d598c9bdb3af2ad1e84f21d896abd4de3-integrity/node_modules/color-convert/", {"name":"color-convert","reference":"2.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-color-name-1.1.4-c2a09a87acbde69543de6f63fa3995c826c536a2-integrity/node_modules/color-name/", {"name":"color-name","reference":"1.1.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-7.2.0-1b7dcdcb32b8138801b3e478ba6a51caa89648da-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"7.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-8.1.1-cd6fc17e28500cff56c1b86c0a7fd4a54a73005c-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"8.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-color-9.4.0-17bfcf686288f531db3dea3215510621ccb55954-integrity/node_modules/supports-color/", {"name":"supports-color","reference":"9.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-has-flag-4.0.0-944771fd9c81c81265c4d6941860da06bb59479b-integrity/node_modules/has-flag/", {"name":"has-flag","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cross-spawn-7.0.3-f73a85b9d5d41d045551c177e2882d4ac85728a6-integrity/node_modules/cross-spawn/", {"name":"cross-spawn","reference":"7.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-key-3.1.1-581f6ade658cbba65a0d3380de7753295054f375-integrity/node_modules/path-key/", {"name":"path-key","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shebang-command-2.0.0-ccd0af4f8835fbdc265b82461aaf0c36663f34ea-integrity/node_modules/shebang-command/", {"name":"shebang-command","reference":"2.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shebang-regex-3.0.0-ae16f1644d873ecad843b0307b143362d4c42172-integrity/node_modules/shebang-regex/", {"name":"shebang-regex","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-which-2.0.2-7c6a8dd0a636a0327e10b59c9286eee93f3f51b1-integrity/node_modules/which/", {"name":"which","reference":"2.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isexe-2.0.0-e8fbf374dc556ff8947a10dcb0572d633f2cfa10-integrity/node_modules/isexe/", {"name":"isexe","reference":"2.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-doctrine-3.0.0-addebead72a6574db783639dc87a121773973961-integrity/node_modules/doctrine/", {"name":"doctrine","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esutils-2.0.3-74d2eb4de0b8da1293711910d50775b9b710ef64-integrity/node_modules/esutils/", {"name":"esutils","reference":"2.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-escape-string-regexp-4.0.0-14ba83a5d373e3d311e5afca29cf5bfad965bf34-integrity/node_modules/escape-string-regexp/", {"name":"escape-string-regexp","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-scope-7.2.2-deb4f92563390f32006894af62a22dba1c46423f-integrity/node_modules/eslint-scope/", {"name":"eslint-scope","reference":"7.2.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eslint-scope-5.1.1-e786e59a66cb92b3f6c1fb0d508aab174848f48c-integrity/node_modules/eslint-scope/", {"name":"eslint-scope","reference":"5.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esrecurse-4.3.0-7ad7964d679abb28bee72cec63758b1c5d2c9921-integrity/node_modules/esrecurse/", {"name":"esrecurse","reference":"4.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-estraverse-5.3.0-2eea5290702f26ab8fe5370370ff86c965d21123-integrity/node_modules/estraverse/", {"name":"estraverse","reference":"5.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-estraverse-4.3.0-398ad3f3c5a24948be7725e83d11a7de28cdbd1d-integrity/node_modules/estraverse/", {"name":"estraverse","reference":"4.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-esquery-1.5.0-6ce17738de8577694edd7361c57182ac8cb0db0b-integrity/node_modules/esquery/", {"name":"esquery","reference":"1.5.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-file-entry-cache-6.0.1-211b2dd9659cb0394b073e7323ac3c933d522027-integrity/node_modules/file-entry-cache/", {"name":"file-entry-cache","reference":"6.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flat-cache-3.2.0-2c0c2d5040c99b1632771a9d105725c0115363ee-integrity/node_modules/flat-cache/", {"name":"flat-cache","reference":"3.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flatted-3.2.9-7eb4c67ca1ba34232ca9d2d93e9886e611ad7daf-integrity/node_modules/flatted/", {"name":"flatted","reference":"3.2.9"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-keyv-4.5.4-a879a99e29452f942439f2a405e3af8b31d4de93-integrity/node_modules/keyv/", {"name":"keyv","reference":"4.5.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-buffer-3.0.1-9338802a30d3b6605fbe0613e094008ca8c05a13-integrity/node_modules/json-buffer/", {"name":"json-buffer","reference":"3.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-rimraf-3.0.2-f1a5402ba6220ad52cc1282bac1ae3aa49fd061a-integrity/node_modules/rimraf/", {"name":"rimraf","reference":"3.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-7.2.3-b8df0fb802bbfa8e89bd1d938b4e16578ed44f2b-integrity/node_modules/glob/", {"name":"glob","reference":"7.2.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-10.3.10-0351ebb809fd187fe421ab96af83d3a70715df4b-integrity/node_modules/glob/", {"name":"glob","reference":"10.3.10"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-7.2.0-d15535af7732e02e948f4c41628bd910293f6023-integrity/node_modules/glob/", {"name":"glob","reference":"7.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fs-realpath-1.0.0-1504ad2523158caa40db4a2787cb01411994ea4f-integrity/node_modules/fs.realpath/", {"name":"fs.realpath","reference":"1.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-inflight-1.0.6-49bd6331d7d02d0c09bc910a1075ba8165b56df9-integrity/node_modules/inflight/", {"name":"inflight","reference":"1.0.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-once-1.4.0-583b1aa775961d4b113ac17d9c50baef9dd76bd1-integrity/node_modules/once/", {"name":"once","reference":"1.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrappy-1.0.2-b5243d8f3ec1aa35f1364605bc0d1036e30ab69f-integrity/node_modules/wrappy/", {"name":"wrappy","reference":"1.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-inherits-2.0.4-0fa2c64f932917c3433a0ded55363aae37416b7c-integrity/node_modules/inherits/", {"name":"inherits","reference":"2.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-is-absolute-1.0.1-174b9268735534ffbc7ace6bf53a5a9e1b5c5f5f-integrity/node_modules/path-is-absolute/", {"name":"path-is-absolute","reference":"1.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-find-up-5.0.0-4c92819ecb7083561e4f4a240a86be5198f536fc-integrity/node_modules/find-up/", {"name":"find-up","reference":"5.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-find-up-4.1.0-97afe7d6cdc0bc5928584b7c8d7b16e8a9aa5d19-integrity/node_modules/find-up/", {"name":"find-up","reference":"4.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-locate-path-6.0.0-55321eb309febbc59c4801d931a72452a681d286-integrity/node_modules/locate-path/", {"name":"locate-path","reference":"6.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-locate-path-5.0.0-1afba396afd676a6d42504d0a67a3a7eb9f62aa0-integrity/node_modules/locate-path/", {"name":"locate-path","reference":"5.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-locate-5.0.0-83c8315c6785005e3bd021839411c9e110e6d834-integrity/node_modules/p-locate/", {"name":"p-locate","reference":"5.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-locate-4.1.0-a3428bb7088b3a60292f66919278b7c297ad4f07-integrity/node_modules/p-locate/", {"name":"p-locate","reference":"4.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-limit-3.1.0-e1daccbe78d0d1388ca18c64fea38e3e57e3706b-integrity/node_modules/p-limit/", {"name":"p-limit","reference":"3.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-limit-2.3.0-3dd33c647a214fdfffd835933eb086da0dc21db1-integrity/node_modules/p-limit/", {"name":"p-limit","reference":"2.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yocto-queue-0.1.0-0294eb3dee05028d31ee1a5fa2c556a6aaf10a1b-integrity/node_modules/yocto-queue/", {"name":"yocto-queue","reference":"0.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-exists-4.0.0-513bdbe2d3b95d7762e8c1137efa195c6c61b5b3-integrity/node_modules/path-exists/", {"name":"path-exists","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-imurmurhash-0.1.4-9218b9b2b928a238b13dc4fb6b6d576f231453ea-integrity/node_modules/imurmurhash/", {"name":"imurmurhash","reference":"0.1.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-path-inside-3.0.3-d231362e53a07ff2b0e0ea7fed049161ffd16283-integrity/node_modules/is-path-inside/", {"name":"is-path-inside","reference":"3.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-stable-stringify-without-jsonify-1.0.1-9db7b59496ad3f3cfef30a75142d2d930ad72651-integrity/node_modules/json-stable-stringify-without-jsonify/", {"name":"json-stable-stringify-without-jsonify","reference":"1.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-levn-0.4.1-ae4562c007473b932a6200d403268dd2fffc6ade-integrity/node_modules/levn/", {"name":"levn","reference":"0.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-prelude-ls-1.2.1-debc6489d7a6e6b0e7611888cec880337d316396-integrity/node_modules/prelude-ls/", {"name":"prelude-ls","reference":"1.2.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-type-check-0.4.0-07b8203bfa7056c0657050e3ccd2c37730bab8f1-integrity/node_modules/type-check/", {"name":"type-check","reference":"0.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lodash-merge-4.6.2-558aa53b43b661e1925a0afdfa36a9a1085fe57a-integrity/node_modules/lodash.merge/", {"name":"lodash.merge","reference":"4.6.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-optionator-0.9.3-007397d44ed1872fdc6ed31360190f81814e2c64-integrity/node_modules/optionator/", {"name":"optionator","reference":"0.9.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@aashutoshrathi-word-wrap-1.2.6-bd9154aec9983f77b3a034ecaa015c2e4201f6cf-integrity/node_modules/@aashutoshrathi/word-wrap/", {"name":"@aashutoshrathi/word-wrap","reference":"1.2.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-deep-is-0.1.4-a6f2dce612fadd2ef1f519b73551f17e85199831-integrity/node_modules/deep-is/", {"name":"deep-is","reference":"0.1.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fast-levenshtein-2.0.6-3d8a5c66883a16a30ca8643e851f19baa7797917-integrity/node_modules/fast-levenshtein/", {"name":"fast-levenshtein","reference":"2.0.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-6.0.1-9e26c63d30f53443e9489495b2105d37b67a85d9-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"6.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-7.1.0-d5b6568ca689d8561370b0707685d22434faff45-integrity/node_modules/strip-ansi/", {"name":"strip-ansi","reference":"7.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-regex-5.0.1-082cb2c89c9fe8659a311a53bd6a4dc5301db304-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"5.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-regex-6.0.1-3183e38fae9a65d7cb5e53945cd5897d0260a06a-integrity/node_modules/ansi-regex/", {"name":"ansi-regex","reference":"6.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-text-table-0.2.0-7f5ee823ae805207c00af2df4a84ec3fcfa570b4-integrity/node_modules/text-table/", {"name":"text-table","reference":"0.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-typescript-5.3.3-b3ce6ba258e72e6305ba66f5c9b452aaee3ffe37-integrity/node_modules/typescript/", {"name":"typescript","reference":"5.3.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ts-loader-9.5.1-63d5912a86312f1fbe32cef0859fb8b2193d9b89-integrity/node_modules/ts-loader/", {"name":"ts-loader","reference":"9.5.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-enhanced-resolve-5.15.0-1af946c7d93603eb88e9896cee4904dc012e9c35-integrity/node_modules/enhanced-resolve/", {"name":"enhanced-resolve","reference":"5.15.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-graceful-fs-4.2.11-4183e4e8bf08bb6e05bbb2f7d2e0c8f712ca40e3-integrity/node_modules/graceful-fs/", {"name":"graceful-fs","reference":"4.2.11"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-tapable-2.2.1-1967a73ef4060a82f12ab96af86d52fdb76eeca0-integrity/node_modules/tapable/", {"name":"tapable","reference":"2.2.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-0.7.4-a9bbe705c9d8846f4e08ff6765acf0f1b0898656-integrity/node_modules/source-map/", {"name":"source-map","reference":"0.7.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-0.6.1-74722af32e9614e9c287a8d0bbde48b5e2f1a263-integrity/node_modules/source-map/", {"name":"source-map","reference":"0.6.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-5.89.0-56b8bf9a34356e93a6625770006490bf3a7f32dc-integrity/node_modules/webpack/", {"name":"webpack","reference":"5.89.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-eslint-scope-3.7.7-3108bd5f18b0cdb277c867b3dd449c9ed7079ac5-integrity/node_modules/@types/eslint-scope/", {"name":"@types/eslint-scope","reference":"3.7.7"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-eslint-8.56.2-1c72a9b794aa26a8b94ad26d5b9aa51c8a6384bb-integrity/node_modules/@types/eslint/", {"name":"@types/eslint","reference":"8.56.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@types-estree-1.0.5-a6ce3e556e00fd9895dd872dd172ad0d4bd687f4-integrity/node_modules/@types/estree/", {"name":"@types/estree","reference":"1.0.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ast-1.11.6-db046555d3c413f8966ca50a95176a0e2c642e24-integrity/node_modules/@webassemblyjs/ast/", {"name":"@webassemblyjs/ast","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-numbers-1.11.6-cbce5e7e0c1bd32cf4905ae444ef64cea919f1b5-integrity/node_modules/@webassemblyjs/helper-numbers/", {"name":"@webassemblyjs/helper-numbers","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-floating-point-hex-parser-1.11.6-dacbcb95aff135c8260f77fa3b4c5fea600a6431-integrity/node_modules/@webassemblyjs/floating-point-hex-parser/", {"name":"@webassemblyjs/floating-point-hex-parser","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-api-error-1.11.6-6132f68c4acd59dcd141c44b18cbebbd9f2fa768-integrity/node_modules/@webassemblyjs/helper-api-error/", {"name":"@webassemblyjs/helper-api-error","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@xtuc-long-4.2.2-d291c6a4e97989b5c61d9acf396ae4fe133a718d-integrity/node_modules/@xtuc/long/", {"name":"@xtuc/long","reference":"4.2.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-bytecode-1.11.6-bb2ebdb3b83aa26d9baad4c46d4315283acd51e9-integrity/node_modules/@webassemblyjs/helper-wasm-bytecode/", {"name":"@webassemblyjs/helper-wasm-bytecode","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-edit-1.11.6-c72fa8220524c9b416249f3d94c2958dfe70ceab-integrity/node_modules/@webassemblyjs/wasm-edit/", {"name":"@webassemblyjs/wasm-edit","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-buffer-1.11.6-b66d73c43e296fd5e88006f18524feb0f2c7c093-integrity/node_modules/@webassemblyjs/helper-buffer/", {"name":"@webassemblyjs/helper-buffer","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-helper-wasm-section-1.11.6-ff97f3863c55ee7f580fd5c41a381e9def4aa577-integrity/node_modules/@webassemblyjs/helper-wasm-section/", {"name":"@webassemblyjs/helper-wasm-section","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-gen-1.11.6-fb5283e0e8b4551cc4e9c3c0d7184a65faf7c268-integrity/node_modules/@webassemblyjs/wasm-gen/", {"name":"@webassemblyjs/wasm-gen","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-ieee754-1.11.6-bb665c91d0b14fffceb0e38298c329af043c6e3a-integrity/node_modules/@webassemblyjs/ieee754/", {"name":"@webassemblyjs/ieee754","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@xtuc-ieee754-1.2.0-eef014a3145ae477a1cbc00cd1e552336dceb790-integrity/node_modules/@xtuc/ieee754/", {"name":"@xtuc/ieee754","reference":"1.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-leb128-1.11.6-70e60e5e82f9ac81118bc25381a0b283893240d7-integrity/node_modules/@webassemblyjs/leb128/", {"name":"@webassemblyjs/leb128","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-utf8-1.11.6-90f8bc34c561595fe156603be7253cdbcd0fab5a-integrity/node_modules/@webassemblyjs/utf8/", {"name":"@webassemblyjs/utf8","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-opt-1.11.6-d9a22d651248422ca498b09aa3232a81041487c2-integrity/node_modules/@webassemblyjs/wasm-opt/", {"name":"@webassemblyjs/wasm-opt","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wasm-parser-1.11.6-bb85378c527df824004812bbdb784eea539174a1-integrity/node_modules/@webassemblyjs/wasm-parser/", {"name":"@webassemblyjs/wasm-parser","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webassemblyjs-wast-printer-1.11.6-a7bf8dd7e362aeb1668ff43f35cb849f188eff20-integrity/node_modules/@webassemblyjs/wast-printer/", {"name":"@webassemblyjs/wast-printer","reference":"1.11.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-acorn-import-assertions-1.9.0-507276249d684797c84e0734ef84860334cfb1ac-integrity/node_modules/acorn-import-assertions/", {"name":"acorn-import-assertions","reference":"1.9.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-browserslist-4.22.2-704c4943072bd81ea18997f3bd2180e89c77874b-integrity/node_modules/browserslist/", {"name":"browserslist","reference":"4.22.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-caniuse-lite-1.0.30001576-893be772cf8ee6056d6c1e2d07df365b9ec0a5c4-integrity/node_modules/caniuse-lite/", {"name":"caniuse-lite","reference":"1.0.30001576"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-electron-to-chromium-1.4.629-9cbffe1b08a5627b6a25118360f7fd3965416caf-integrity/node_modules/electron-to-chromium/", {"name":"electron-to-chromium","reference":"1.4.629"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-node-releases-2.0.14-2ffb053bceb8b2be8495ece1ab6ce600c4461b0b-integrity/node_modules/node-releases/", {"name":"node-releases","reference":"2.0.14"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-update-browserslist-db-1.0.13-3c5e4f5c083661bd38ef64b6328c26ed6c8248c4-integrity/node_modules/update-browserslist-db/", {"name":"update-browserslist-db","reference":"1.0.13"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-escalade-3.1.1-d8cfdc7000965c5a0174b4a82eaa5c0552742e40-integrity/node_modules/escalade/", {"name":"escalade","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-picocolors-1.0.0-cb5bdc74ff3f51892236eaf79d68bc44564ab81c-integrity/node_modules/picocolors/", {"name":"picocolors","reference":"1.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chrome-trace-event-1.0.3-1015eced4741e15d06664a957dbbf50d041e26ac-integrity/node_modules/chrome-trace-event/", {"name":"chrome-trace-event","reference":"1.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-es-module-lexer-1.4.1-41ea21b43908fe6a287ffcbe4300f790555331f5-integrity/node_modules/es-module-lexer/", {"name":"es-module-lexer","reference":"1.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-events-3.3.0-31a95ad0a924e2d2c419a813aeb2c4e878ea7400-integrity/node_modules/events/", {"name":"events","reference":"3.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-glob-to-regexp-0.4.1-c75297087c851b9a578bd217dd59a92f59fe546e-integrity/node_modules/glob-to-regexp/", {"name":"glob-to-regexp","reference":"0.4.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-json-parse-even-better-errors-2.3.1-7c47805a94319928e05777405dc12e1f7a4ee02d-integrity/node_modules/json-parse-even-better-errors/", {"name":"json-parse-even-better-errors","reference":"2.3.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-loader-runner-4.3.0-c1b4a163b99f614830353b16755e7149ac2314e1-integrity/node_modules/loader-runner/", {"name":"loader-runner","reference":"4.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mime-types-2.1.35-381a871b62a734450660ae3deee44813f70d959a-integrity/node_modules/mime-types/", {"name":"mime-types","reference":"2.1.35"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mime-db-1.52.0-bbabcdc02859f4987301c856e3387ce5ec43bf70-integrity/node_modules/mime-db/", {"name":"mime-db","reference":"1.52.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-neo-async-2.6.2-b4aafb93e3aeb2d8174ca53cf163ab7d7308305f-integrity/node_modules/neo-async/", {"name":"neo-async","reference":"2.6.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-schema-utils-3.3.0-f50a88877c3c01652a15b622ae9e9795df7a60fe-integrity/node_modules/schema-utils/", {"name":"schema-utils","reference":"3.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ajv-keywords-3.5.2-31f29da5ab6e00d1c2d329acf7b5929614d5014d-integrity/node_modules/ajv-keywords/", {"name":"ajv-keywords","reference":"3.5.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-terser-webpack-plugin-5.3.10-904f4c9193c6fd2a03f693a2150c62a92f40d199-integrity/node_modules/terser-webpack-plugin/", {"name":"terser-webpack-plugin","reference":"5.3.10"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-trace-mapping-0.3.21-5dc1df7b3dc4a6209e503a924e1ca56097a2bb15-integrity/node_modules/@jridgewell/trace-mapping/", {"name":"@jridgewell/trace-mapping","reference":"0.3.21"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-resolve-uri-3.1.1-c08679063f279615a3326583ba3a90d1d82cc721-integrity/node_modules/@jridgewell/resolve-uri/", {"name":"@jridgewell/resolve-uri","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-sourcemap-codec-1.4.15-d7c6e6755c78567a951e04ab52ef0fd26de59f32-integrity/node_modules/@jridgewell/sourcemap-codec/", {"name":"@jridgewell/sourcemap-codec","reference":"1.4.15"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jest-worker-27.5.1-8d146f0900e8973b106b6f73cc1e9a8cb86f8db0-integrity/node_modules/jest-worker/", {"name":"jest-worker","reference":"27.5.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-merge-stream-2.0.0-52823629a14dd00c9770fb6ad47dc6310f2c1f60-integrity/node_modules/merge-stream/", {"name":"merge-stream","reference":"2.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.2-defa1e055c83bf6d59ea805d8da862254eb6a6c2-integrity/node_modules/serialize-javascript/", {"name":"serialize-javascript","reference":"6.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-serialize-javascript-6.0.0-efae5d88f45d7924141da8b5c3a7a7e663fefeb8-integrity/node_modules/serialize-javascript/", {"name":"serialize-javascript","reference":"6.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-randombytes-2.1.0-df6f84372f0270dc65cdf6291349ab7a473d4f2a-integrity/node_modules/randombytes/", {"name":"randombytes","reference":"2.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.2.1-1eaf9fa9bdb1fdd4ec75f58f9cdb4e6b7827eec6-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.2.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-safe-buffer-5.1.2-991ec69d296e0313747d59bdfd2b745c35f8828d-integrity/node_modules/safe-buffer/", {"name":"safe-buffer","reference":"5.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-terser-5.26.0-ee9f05d929f4189a9c28a0feb889d96d50126fe1-integrity/node_modules/terser/", {"name":"terser","reference":"5.26.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-source-map-0.3.5-a3bb4d5c6825aab0d281268f47f6ad5853431e91-integrity/node_modules/@jridgewell/source-map/", {"name":"@jridgewell/source-map","reference":"0.3.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-gen-mapping-0.3.3-7e02e6eb5df901aaedb08514203b096614024098-integrity/node_modules/@jridgewell/gen-mapping/", {"name":"@jridgewell/gen-mapping","reference":"0.3.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@jridgewell-set-array-1.1.2-7c6cf998d6d20b914c0a55a91ae928ff25965e72-integrity/node_modules/@jridgewell/set-array/", {"name":"@jridgewell/set-array","reference":"1.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-commander-2.20.3-fd485e84c03eb4881c20722ba48035e8531aeb33-integrity/node_modules/commander/", {"name":"commander","reference":"2.20.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-commander-10.0.1-881ee46b4f77d1c1dccc5823433aa39b022cbe06-integrity/node_modules/commander/", {"name":"commander","reference":"10.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-source-map-support-0.5.21-04fe7c7f9e1ed2d662233c28cb2b35b9f63f6e4f-integrity/node_modules/source-map-support/", {"name":"source-map-support","reference":"0.5.21"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-buffer-from-1.1.2-2b146a6fd72e80b4f55d255f35ed59a3a9a41bd5-integrity/node_modules/buffer-from/", {"name":"buffer-from","reference":"1.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-watchpack-2.4.0-fa33032374962c78113f93c7f2fb4c54c9862a5d-integrity/node_modules/watchpack/", {"name":"watchpack","reference":"2.4.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-sources-3.2.3-2d4daab8451fd4b240cc27055ff6a0c2ccea0cde-integrity/node_modules/webpack-sources/", {"name":"webpack-sources","reference":"3.2.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-cli-5.1.4-c8e046ba7eaae4911d7e71e2b25b776fcc35759b-integrity/node_modules/webpack-cli/", {"name":"webpack-cli","reference":"5.1.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@discoveryjs-json-ext-0.5.7-1d572bfbbe14b7704e0ba0f39b74815b84870d70-integrity/node_modules/@discoveryjs/json-ext/", {"name":"@discoveryjs/json-ext","reference":"0.5.7"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-configtest-2.1.1-3b2f852e91dac6e3b85fb2a314fb8bef46d94646-integrity/node_modules/@webpack-cli/configtest/", {"name":"@webpack-cli/configtest","reference":"2.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-info-2.0.2-cc3fbf22efeb88ff62310cf885c5b09f44ae0fdd-integrity/node_modules/@webpack-cli/info/", {"name":"@webpack-cli/info","reference":"2.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@webpack-cli-serve-2.0.5-325db42395cd49fe6c14057f9a900e427df8810e-integrity/node_modules/@webpack-cli/serve/", {"name":"@webpack-cli/serve","reference":"2.0.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-colorette-2.0.20-9eb793e6833067f7235902fcd3b09917a000a95a-integrity/node_modules/colorette/", {"name":"colorette","reference":"2.0.20"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-envinfo-7.11.0-c3793f44284a55ff8c82faf1ffd91bc6478ea01f-integrity/node_modules/envinfo/", {"name":"envinfo","reference":"7.11.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-fastest-levenshtein-1.0.16-210e61b6ff181de91ea9b3d1b84fdedd47e034e5-integrity/node_modules/fastest-levenshtein/", {"name":"fastest-levenshtein","reference":"1.0.16"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-import-local-3.1.0-b4479df8a5fd44f6cdce24070675676063c95cb4-integrity/node_modules/import-local/", {"name":"import-local","reference":"3.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-pkg-dir-4.2.0-f099133df7ede422e81d1d8448270eeb3e4261f3-integrity/node_modules/pkg-dir/", {"name":"pkg-dir","reference":"4.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-p-try-2.2.0-cb2868540e313d61de58fafbe35ce9004d5540e6-integrity/node_modules/p-try/", {"name":"p-try","reference":"2.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-cwd-3.0.0-0f0075f1bb2544766cf73ba6a6e2adfebcb13f2d-integrity/node_modules/resolve-cwd/", {"name":"resolve-cwd","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-interpret-3.1.1-5be0ceed67ca79c6c4bc5cf0d7ee843dcea110c4-integrity/node_modules/interpret/", {"name":"interpret","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-rechoir-0.8.0-49f866e0d32146142da3ad8f0eff352b3215ff22-integrity/node_modules/rechoir/", {"name":"rechoir","reference":"0.8.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-resolve-1.22.8-b6c87a9f2aa06dfab52e3d70ac8cde321fa5a48d-integrity/node_modules/resolve/", {"name":"resolve","reference":"1.22.8"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-core-module-2.13.1-ad0d7532c6fea9da1ebdc82742d74525c6273384-integrity/node_modules/is-core-module/", {"name":"is-core-module","reference":"2.13.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-hasown-2.0.0-f4c513d454a57b7c7e1650778de226b11700546c-integrity/node_modules/hasown/", {"name":"hasown","reference":"2.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-function-bind-1.1.2-2c02d864d97f3ea6c8830c464cbd11ab6eab7a1c-integrity/node_modules/function-bind/", {"name":"function-bind","reference":"1.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-parse-1.0.7-fbc114b60ca42b30d9daf5858e4bd68bbedb6735-integrity/node_modules/path-parse/", {"name":"path-parse","reference":"1.0.7"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-supports-preserve-symlinks-flag-1.0.0-6eda4bd344a3c94aea376d4cc31bc77311039e09-integrity/node_modules/supports-preserve-symlinks-flag/", {"name":"supports-preserve-symlinks-flag","reference":"1.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-webpack-merge-5.10.0-a3ad5d773241e9c682803abf628d4cd62b8a4177-integrity/node_modules/webpack-merge/", {"name":"webpack-merge","reference":"5.10.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-clone-deep-4.0.1-c19fd9bdbbf85942b4fd979c84dcf7d5f07c2387-integrity/node_modules/clone-deep/", {"name":"clone-deep","reference":"4.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-plain-object-2.0.4-2c163b3fafb1b606d9d17928f05c2a1c38e07677-integrity/node_modules/is-plain-object/", {"name":"is-plain-object","reference":"2.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isobject-3.0.1-4e431e92b11a9731636aa1f9c8d1ccbcfdab78df-integrity/node_modules/isobject/", {"name":"isobject","reference":"3.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-kind-of-6.0.3-07c05034a6c349fa06e24fa35aa76db4580ce4dd-integrity/node_modules/kind-of/", {"name":"kind-of","reference":"6.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-shallow-clone-3.0.1-8f2981ad92531f55035b01fb230769a40e02efa3-integrity/node_modules/shallow-clone/", {"name":"shallow-clone","reference":"3.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-flat-5.0.2-8ca6fe332069ffa9d324c327198c598259ceb241-integrity/node_modules/flat/", {"name":"flat","reference":"5.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wildcard-2.0.1-5ab10d02487198954836b6349f74fff961e10f67-integrity/node_modules/wildcard/", {"name":"wildcard","reference":"2.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@vscode-test-cli-0.0.4-eeeb5620ff8b9eb31ae3e5b01af322ca68fcfaae-integrity/node_modules/@vscode/test-cli/", {"name":"@vscode/test-cli","reference":"0.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-chokidar-3.5.3-1cf37c8707b932bd1af1ae22c0432e2acd1903bd-integrity/node_modules/chokidar/", {"name":"chokidar","reference":"3.5.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-anymatch-3.1.3-790c58b19ba1720a84205b57c618d5ad8524973e-integrity/node_modules/anymatch/", {"name":"anymatch","reference":"3.1.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-normalize-path-3.0.0-0dcd69ff23a1c9b11fd0978316644a0388216a65-integrity/node_modules/normalize-path/", {"name":"normalize-path","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-binary-path-2.1.0-ea1f7f3b80f064236e83470f86c09c254fb45b09-integrity/node_modules/is-binary-path/", {"name":"is-binary-path","reference":"2.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-binary-extensions-2.2.0-75f502eeaf9ffde42fc98829645be4ea76bd9e2d-integrity/node_modules/binary-extensions/", {"name":"binary-extensions","reference":"2.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-readdirp-3.6.0-74a370bd857116e245b29cc97340cd431a02a6c7-integrity/node_modules/readdirp/", {"name":"readdirp","reference":"3.6.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-foreground-child-3.1.1-1d173e776d75d2772fed08efe4a0de1ea1b12d0d-integrity/node_modules/foreground-child/", {"name":"foreground-child","reference":"3.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-signal-exit-4.1.0-952188c1cbd546070e2dd20d0f41c0ae0530cb04-integrity/node_modules/signal-exit/", {"name":"signal-exit","reference":"4.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jackspeak-2.3.6-647ecc472238aee4b06ac0e461acc21a8c505ca8-integrity/node_modules/jackspeak/", {"name":"jackspeak","reference":"2.3.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@isaacs-cliui-8.0.2-b37667b7bc181c168782259bab42474fbf52b550-integrity/node_modules/@isaacs/cliui/", {"name":"@isaacs/cliui","reference":"8.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-5.1.2-14f8daec6d81e7221d2a357e668cab73bdbca794-integrity/node_modules/string-width/", {"name":"string-width","reference":"5.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-4.2.3-269c7117d27b05ad2e536830a8ec895ef9c6d010-integrity/node_modules/string-width/", {"name":"string-width","reference":"4.2.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-eastasianwidth-0.2.0-696ce2ec0aa0e6ea93a397ffcf24aa7840c827cb-integrity/node_modules/eastasianwidth/", {"name":"eastasianwidth","reference":"0.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-emoji-regex-9.2.2-840c8803b0d8047f4ff0cf963176b32d4ef3ed72-integrity/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"9.2.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-emoji-regex-8.0.0-e818fd69ce5ccfcb404594f842963bf53164cc37-integrity/node_modules/emoji-regex/", {"name":"emoji-regex","reference":"8.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-width-cjs-4.2.3-269c7117d27b05ad2e536830a8ec895ef9c6d010-integrity/node_modules/string-width-cjs/", {"name":"string-width-cjs","reference":"4.2.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-fullwidth-code-point-3.0.0-f116f8064fe90b3f7844a38997c0b75051269f1d-integrity/node_modules/is-fullwidth-code-point/", {"name":"is-fullwidth-code-point","reference":"3.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-strip-ansi-cjs-6.0.1-9e26c63d30f53443e9489495b2105d37b67a85d9-integrity/node_modules/strip-ansi-cjs/", {"name":"strip-ansi-cjs","reference":"6.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-8.1.0-56dc22368ee570face1b49819975d9b9a5ead214-integrity/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"8.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-7.0.0-67e145cff510a6a6984bdf1152911d69d2eb9e43-integrity/node_modules/wrap-ansi/", {"name":"wrap-ansi","reference":"7.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-wrap-ansi-cjs-7.0.0-67e145cff510a6a6984bdf1152911d69d2eb9e43-integrity/node_modules/wrap-ansi-cjs/", {"name":"wrap-ansi-cjs","reference":"7.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@pkgjs-parseargs-0.11.0-a77ea742fab25775145434eb1d2328cf5013ac33-integrity/node_modules/@pkgjs/parseargs/", {"name":"@pkgjs/parseargs","reference":"0.11.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-minipass-7.0.4-dbce03740f50a4786ba994c1fb908844d27b038c-integrity/node_modules/minipass/", {"name":"minipass","reference":"7.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-path-scurry-1.10.1-9ba6bf5aa8500fe9fd67df4f0d9483b2b0bfc698-integrity/node_modules/path-scurry/", {"name":"path-scurry","reference":"1.10.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-mocha-10.2.0-1fd4a7c32ba5ac372e03a17eef435bd00e5c68b8-integrity/node_modules/mocha/", {"name":"mocha","reference":"10.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-ansi-colors-4.1.1-cbb9ae256bf750af1eab344f229aa27fe94ba348-integrity/node_modules/ansi-colors/", {"name":"ansi-colors","reference":"4.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-browser-stdout-1.3.1-baa559ee14ced73452229bad7326467c61fabd60-integrity/node_modules/browser-stdout/", {"name":"browser-stdout","reference":"1.3.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-diff-5.0.0-7ed6ad76d859d030787ec35855f5b1daf31d852b-integrity/node_modules/diff/", {"name":"diff","reference":"5.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-he-1.2.0-84ae65fa7eafb165fddb61566ae14baf05664f0f-integrity/node_modules/he/", {"name":"he","reference":"1.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-log-symbols-4.1.0-3fbdbb95b4683ac9fc785111e792e558d4abd503-integrity/node_modules/log-symbols/", {"name":"log-symbols","reference":"4.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-unicode-supported-0.1.0-3f26c76a809593b52bfa2ecb5710ed2779b522a7-integrity/node_modules/is-unicode-supported/", {"name":"is-unicode-supported","reference":"0.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-nanoid-3.3.3-fd8e8b7aa761fe807dba2d1b98fb7241bb724a25-integrity/node_modules/nanoid/", {"name":"nanoid","reference":"3.3.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-workerpool-6.2.1-46fc150c17d826b86a008e5a4508656777e9c343-integrity/node_modules/workerpool/", {"name":"workerpool","reference":"6.2.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-16.2.0-1c82bf0f6b6a66eafce7ef30e376f49a12477f66-integrity/node_modules/yargs/", {"name":"yargs","reference":"16.2.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-17.7.2-991df39aca675a192b816e1e0363f9d75d2aa269-integrity/node_modules/yargs/", {"name":"yargs","reference":"17.7.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cliui-7.0.4-a0265ee655476fc807aea9df3df8df7783808b4f-integrity/node_modules/cliui/", {"name":"cliui","reference":"7.0.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-cliui-8.0.1-0c04b075db02cbfe60dc8e6cf2f5486b1a3608aa-integrity/node_modules/cliui/", {"name":"cliui","reference":"8.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-get-caller-file-2.0.5-4f94412a82db32f36e3b0b9741f8a97feb031f7e-integrity/node_modules/get-caller-file/", {"name":"get-caller-file","reference":"2.0.5"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-require-directory-2.1.1-8c64ad5fd30dab1c976e2344ffe7f792a6a6df42-integrity/node_modules/require-directory/", {"name":"require-directory","reference":"2.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-y18n-5.0.8-7f4934d0f7ca8c56f95314939ddcd2dd91ce1d55-integrity/node_modules/y18n/", {"name":"y18n","reference":"5.0.8"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-20.2.9-2eb7dc3b0289718fc295f362753845c41a0c94ee-integrity/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"20.2.9"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-20.2.4-b42890f14566796f85ae8e3a25290d205f154a54-integrity/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"20.2.4"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-parser-21.1.1-9096bceebf990d21bb31fa9516e0ede294a77d35-integrity/node_modules/yargs-parser/", {"name":"yargs-parser","reference":"21.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-yargs-unparser-2.0.0-f131f9226911ae5d9ad38c432fe809366c2325eb-integrity/node_modules/yargs-unparser/", {"name":"yargs-unparser","reference":"2.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-camelcase-6.3.0-5685b95eb209ac9c0c177467778c9c84df58ba9a-integrity/node_modules/camelcase/", {"name":"camelcase","reference":"6.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-decamelize-4.0.0-aa472d7bf660eb15f3494efd531cab7f2a709837-integrity/node_modules/decamelize/", {"name":"decamelize","reference":"4.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-is-plain-obj-2.1.0-45e42e37fccf1f40da8e5f76ee21515840c09287-integrity/node_modules/is-plain-obj/", {"name":"is-plain-obj","reference":"2.1.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@vscode-test-electron-2.3.8-06a7c50b38cfac0ede833905e088d55c61cd12d3-integrity/node_modules/@vscode/test-electron/", {"name":"@vscode/test-electron","reference":"2.3.8"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-http-proxy-agent-4.0.1-8a8c8ef7f5932ccf953c296ca8291b95aa74aa3a-integrity/node_modules/http-proxy-agent/", {"name":"http-proxy-agent","reference":"4.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-@tootallnate-once-1.1.2-ccb91445360179a04e7fe6aff78c00ffc1eeaf82-integrity/node_modules/@tootallnate/once/", {"name":"@tootallnate/once","reference":"1.1.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-agent-base-6.0.2-49fff58577cfee3f37176feab4c22e00f86d7f77-integrity/node_modules/agent-base/", {"name":"agent-base","reference":"6.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-https-proxy-agent-5.0.1-c59ef224a04fe8b754f3db0063a25ea30d0005d6-integrity/node_modules/https-proxy-agent/", {"name":"https-proxy-agent","reference":"5.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-jszip-3.10.1-34aee70eb18ea1faec2f589208a157d1feb091c2-integrity/node_modules/jszip/", {"name":"jszip","reference":"3.10.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-lie-3.3.0-dcf82dee545f46074daf200c7c1c5a08e0f40f6a-integrity/node_modules/lie/", {"name":"lie","reference":"3.3.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-immediate-3.0.6-9db1dbd0faf8de6fbe0f5dd5e56bb606280de69b-integrity/node_modules/immediate/", {"name":"immediate","reference":"3.0.6"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-pako-1.0.11-6c9599d340d54dfd3946380252a35705a6b992bf-integrity/node_modules/pako/", {"name":"pako","reference":"1.0.11"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-readable-stream-2.3.8-91125e8042bba1b9887f49345f6277027ce8be9b-integrity/node_modules/readable-stream/", {"name":"readable-stream","reference":"2.3.8"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-core-util-is-1.0.3-a6042d3634c2b27e9328f837b965fac83808db85-integrity/node_modules/core-util-is/", {"name":"core-util-is","reference":"1.0.3"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-isarray-1.0.0-bb935d48582cba168c06834957a54a3e07124f11-integrity/node_modules/isarray/", {"name":"isarray","reference":"1.0.0"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-process-nextick-args-2.0.1-7820d9b16120cc55ca9ae7792680ae7dba6d7fe2-integrity/node_modules/process-nextick-args/", {"name":"process-nextick-args","reference":"2.0.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-string-decoder-1.1.1-9cf1611ba62685d7030ae9e4ba34149c3af03fc8-integrity/node_modules/string_decoder/", {"name":"string_decoder","reference":"1.1.1"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-util-deprecate-1.0.2-450d4dc9fa70de732762fbd2d4a28981419a0ccf-integrity/node_modules/util-deprecate/", {"name":"util-deprecate","reference":"1.0.2"}],
  ["../../../Users/mrowr/AppData/Local/Yarn/Cache/v6/npm-setimmediate-1.0.5-290cbb232e306942d7d7ea9b83732ab7856f8285-integrity/node_modules/setimmediate/", {"name":"setimmediate","reference":"1.0.5"}],
  ["./", topLevelLocator],
]);
exports.findPackageLocator = function findPackageLocator(location) {
  let relativeLocation = normalizePath(path.relative(__dirname, location));

  if (!relativeLocation.match(isStrictRegExp))
    relativeLocation = `./${relativeLocation}`;

  if (location.match(isDirRegExp) && relativeLocation.charAt(relativeLocation.length - 1) !== '/')
    relativeLocation = `${relativeLocation}/`;

  let match;

  if (relativeLocation.length >= 206 && relativeLocation[205] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 206)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 199 && relativeLocation[198] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 199)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 198 && relativeLocation[197] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 198)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 196 && relativeLocation[195] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 196)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 194 && relativeLocation[193] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 194)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 190 && relativeLocation[189] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 190)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 188 && relativeLocation[187] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 188)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 187 && relativeLocation[186] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 187)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 185 && relativeLocation[184] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 185)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 184 && relativeLocation[183] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 184)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 183 && relativeLocation[182] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 183)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 182 && relativeLocation[181] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 182)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 181 && relativeLocation[180] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 181)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 180 && relativeLocation[179] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 180)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 178 && relativeLocation[177] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 178)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 177 && relativeLocation[176] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 177)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 176 && relativeLocation[175] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 176)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 175 && relativeLocation[174] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 175)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 174 && relativeLocation[173] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 174)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 172 && relativeLocation[171] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 172)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 171 && relativeLocation[170] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 171)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 170 && relativeLocation[169] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 170)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 169 && relativeLocation[168] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 169)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 168 && relativeLocation[167] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 168)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 167 && relativeLocation[166] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 167)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 165 && relativeLocation[164] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 165)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 164 && relativeLocation[163] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 164)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 163 && relativeLocation[162] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 163)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 162 && relativeLocation[161] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 162)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 161 && relativeLocation[160] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 161)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 159 && relativeLocation[158] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 159)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 158 && relativeLocation[157] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 158)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 157 && relativeLocation[156] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 157)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 156 && relativeLocation[155] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 156)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 155 && relativeLocation[154] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 155)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 154 && relativeLocation[153] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 154)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 153 && relativeLocation[152] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 153)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 152 && relativeLocation[151] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 152)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 151 && relativeLocation[150] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 151)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 150 && relativeLocation[149] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 150)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 149 && relativeLocation[148] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 149)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 148 && relativeLocation[147] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 148)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 147 && relativeLocation[146] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 147)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 146 && relativeLocation[145] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 146)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 145 && relativeLocation[144] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 145)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 144 && relativeLocation[143] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 144)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 143 && relativeLocation[142] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 143)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 141 && relativeLocation[140] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 141)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 140 && relativeLocation[139] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 140)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 139 && relativeLocation[138] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 139)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 138 && relativeLocation[137] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 138)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 137 && relativeLocation[136] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 137)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 136 && relativeLocation[135] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 136)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 135 && relativeLocation[134] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 135)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 134 && relativeLocation[133] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 134)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 133 && relativeLocation[132] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 133)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 132 && relativeLocation[131] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 132)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 131 && relativeLocation[130] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 131)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 129 && relativeLocation[128] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 129)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 106 && relativeLocation[105] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 106)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 100 && relativeLocation[99] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 100)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 88 && relativeLocation[87] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 88)))
      return blacklistCheck(match);

  if (relativeLocation.length >= 2 && relativeLocation[1] === '/')
    if (match = locatorsByLocations.get(relativeLocation.substr(0, 2)))
      return blacklistCheck(match);

  return null;
};


/**
 * Returns the module that should be used to resolve require calls. It's usually the direct parent, except if we're
 * inside an eval expression.
 */

function getIssuerModule(parent) {
  let issuer = parent;

  while (issuer && (issuer.id === '[eval]' || issuer.id === '<repl>' || !issuer.filename)) {
    issuer = issuer.parent;
  }

  return issuer;
}

/**
 * Returns information about a package in a safe way (will throw if they cannot be retrieved)
 */

function getPackageInformationSafe(packageLocator) {
  const packageInformation = exports.getPackageInformation(packageLocator);

  if (!packageInformation) {
    throw makeError(
      `INTERNAL`,
      `Couldn't find a matching entry in the dependency tree for the specified parent (this is probably an internal error)`
    );
  }

  return packageInformation;
}

/**
 * Implements the node resolution for folder access and extension selection
 */

function applyNodeExtensionResolution(unqualifiedPath, {extensions}) {
  // We use this "infinite while" so that we can restart the process as long as we hit package folders
  while (true) {
    let stat;

    try {
      stat = statSync(unqualifiedPath);
    } catch (error) {}

    // If the file exists and is a file, we can stop right there

    if (stat && !stat.isDirectory()) {
      // If the very last component of the resolved path is a symlink to a file, we then resolve it to a file. We only
      // do this first the last component, and not the rest of the path! This allows us to support the case of bin
      // symlinks, where a symlink in "/xyz/pkg-name/.bin/bin-name" will point somewhere else (like "/xyz/pkg-name/index.js").
      // In such a case, we want relative requires to be resolved relative to "/xyz/pkg-name/" rather than "/xyz/pkg-name/.bin/".
      //
      // Also note that the reason we must use readlink on the last component (instead of realpath on the whole path)
      // is that we must preserve the other symlinks, in particular those used by pnp to deambiguate packages using
      // peer dependencies. For example, "/xyz/.pnp/local/pnp-01234569/.bin/bin-name" should see its relative requires
      // be resolved relative to "/xyz/.pnp/local/pnp-0123456789/" rather than "/xyz/pkg-with-peers/", because otherwise
      // we would lose the information that would tell us what are the dependencies of pkg-with-peers relative to its
      // ancestors.

      if (lstatSync(unqualifiedPath).isSymbolicLink()) {
        unqualifiedPath = path.normalize(path.resolve(path.dirname(unqualifiedPath), readlinkSync(unqualifiedPath)));
      }

      return unqualifiedPath;
    }

    // If the file is a directory, we must check if it contains a package.json with a "main" entry

    if (stat && stat.isDirectory()) {
      let pkgJson;

      try {
        pkgJson = JSON.parse(readFileSync(`${unqualifiedPath}/package.json`, 'utf-8'));
      } catch (error) {}

      let nextUnqualifiedPath;

      if (pkgJson && pkgJson.main) {
        nextUnqualifiedPath = path.resolve(unqualifiedPath, pkgJson.main);
      }

      // If the "main" field changed the path, we start again from this new location

      if (nextUnqualifiedPath && nextUnqualifiedPath !== unqualifiedPath) {
        const resolution = applyNodeExtensionResolution(nextUnqualifiedPath, {extensions});

        if (resolution !== null) {
          return resolution;
        }
      }
    }

    // Otherwise we check if we find a file that match one of the supported extensions

    const qualifiedPath = extensions
      .map(extension => {
        return `${unqualifiedPath}${extension}`;
      })
      .find(candidateFile => {
        return existsSync(candidateFile);
      });

    if (qualifiedPath) {
      return qualifiedPath;
    }

    // Otherwise, we check if the path is a folder - in such a case, we try to use its index

    if (stat && stat.isDirectory()) {
      const indexPath = extensions
        .map(extension => {
          return `${unqualifiedPath}/index${extension}`;
        })
        .find(candidateFile => {
          return existsSync(candidateFile);
        });

      if (indexPath) {
        return indexPath;
      }
    }

    // Otherwise there's nothing else we can do :(

    return null;
  }
}

/**
 * This function creates fake modules that can be used with the _resolveFilename function.
 * Ideally it would be nice to be able to avoid this, since it causes useless allocations
 * and cannot be cached efficiently (we recompute the nodeModulePaths every time).
 *
 * Fortunately, this should only affect the fallback, and there hopefully shouldn't be a
 * lot of them.
 */

function makeFakeModule(path) {
  const fakeModule = new Module(path, false);
  fakeModule.filename = path;
  fakeModule.paths = Module._nodeModulePaths(path);
  return fakeModule;
}

/**
 * Normalize path to posix format.
 */

function normalizePath(fsPath) {
  fsPath = path.normalize(fsPath);

  if (process.platform === 'win32') {
    fsPath = fsPath.replace(backwardSlashRegExp, '/');
  }

  return fsPath;
}

/**
 * Forward the resolution to the next resolver (usually the native one)
 */

function callNativeResolution(request, issuer) {
  if (issuer.endsWith('/')) {
    issuer += 'internal.js';
  }

  try {
    enableNativeHooks = false;

    // Since we would need to create a fake module anyway (to call _resolveLookupPath that
    // would give us the paths to give to _resolveFilename), we can as well not use
    // the {paths} option at all, since it internally makes _resolveFilename create another
    // fake module anyway.
    return Module._resolveFilename(request, makeFakeModule(issuer), false);
  } finally {
    enableNativeHooks = true;
  }
}

/**
 * This key indicates which version of the standard is implemented by this resolver. The `std` key is the
 * Plug'n'Play standard, and any other key are third-party extensions. Third-party extensions are not allowed
 * to override the standard, and can only offer new methods.
 *
 * If an new version of the Plug'n'Play standard is released and some extensions conflict with newly added
 * functions, they'll just have to fix the conflicts and bump their own version number.
 */

exports.VERSIONS = {std: 1};

/**
 * Useful when used together with getPackageInformation to fetch information about the top-level package.
 */

exports.topLevel = {name: null, reference: null};

/**
 * Gets the package information for a given locator. Returns null if they cannot be retrieved.
 */

exports.getPackageInformation = function getPackageInformation({name, reference}) {
  const packageInformationStore = packageInformationStores.get(name);

  if (!packageInformationStore) {
    return null;
  }

  const packageInformation = packageInformationStore.get(reference);

  if (!packageInformation) {
    return null;
  }

  return packageInformation;
};

/**
 * Transforms a request (what's typically passed as argument to the require function) into an unqualified path.
 * This path is called "unqualified" because it only changes the package name to the package location on the disk,
 * which means that the end result still cannot be directly accessed (for example, it doesn't try to resolve the
 * file extension, or to resolve directories to their "index.js" content). Use the "resolveUnqualified" function
 * to convert them to fully-qualified paths, or just use "resolveRequest" that do both operations in one go.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveToUnqualified = function resolveToUnqualified(request, issuer, {considerBuiltins = true} = {}) {
  // The 'pnpapi' request is reserved and will always return the path to the PnP file, from everywhere

  if (request === `pnpapi`) {
    return pnpFile;
  }

  // Bailout if the request is a native module

  if (considerBuiltins && builtinModules.has(request)) {
    return null;
  }

  // We allow disabling the pnp resolution for some subpaths. This is because some projects, often legacy,
  // contain multiple levels of dependencies (ie. a yarn.lock inside a subfolder of a yarn.lock). This is
  // typically solved using workspaces, but not all of them have been converted already.

  if (ignorePattern && ignorePattern.test(normalizePath(issuer))) {
    const result = callNativeResolution(request, issuer);

    if (result === false) {
      throw makeError(
        `BUILTIN_NODE_RESOLUTION_FAIL`,
        `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer was explicitely ignored by the regexp "null")`,
        {
          request,
          issuer,
        }
      );
    }

    return result;
  }

  let unqualifiedPath;

  // If the request is a relative or absolute path, we just return it normalized

  const dependencyNameMatch = request.match(pathRegExp);

  if (!dependencyNameMatch) {
    if (path.isAbsolute(request)) {
      unqualifiedPath = path.normalize(request);
    } else if (issuer.match(isDirRegExp)) {
      unqualifiedPath = path.normalize(path.resolve(issuer, request));
    } else {
      unqualifiedPath = path.normalize(path.resolve(path.dirname(issuer), request));
    }
  }

  // Things are more hairy if it's a package require - we then need to figure out which package is needed, and in
  // particular the exact version for the given location on the dependency tree

  if (dependencyNameMatch) {
    const [, dependencyName, subPath] = dependencyNameMatch;

    const issuerLocator = exports.findPackageLocator(issuer);

    // If the issuer file doesn't seem to be owned by a package managed through pnp, then we resort to using the next
    // resolution algorithm in the chain, usually the native Node resolution one

    if (!issuerLocator) {
      const result = callNativeResolution(request, issuer);

      if (result === false) {
        throw makeError(
          `BUILTIN_NODE_RESOLUTION_FAIL`,
          `The builtin node resolution algorithm was unable to resolve the module referenced by "${request}" and requested from "${issuer}" (it didn't go through the pnp resolver because the issuer doesn't seem to be part of the Yarn-managed dependency tree)`,
          {
            request,
            issuer,
          }
        );
      }

      return result;
    }

    const issuerInformation = getPackageInformationSafe(issuerLocator);

    // We obtain the dependency reference in regard to the package that request it

    let dependencyReference = issuerInformation.packageDependencies.get(dependencyName);

    // If we can't find it, we check if we can potentially load it from the packages that have been defined as potential fallbacks.
    // It's a bit of a hack, but it improves compatibility with the existing Node ecosystem. Hopefully we should eventually be able
    // to kill this logic and become stricter once pnp gets enough traction and the affected packages fix themselves.

    if (issuerLocator !== topLevelLocator) {
      for (let t = 0, T = fallbackLocators.length; dependencyReference === undefined && t < T; ++t) {
        const fallbackInformation = getPackageInformationSafe(fallbackLocators[t]);
        dependencyReference = fallbackInformation.packageDependencies.get(dependencyName);
      }
    }

    // If we can't find the path, and if the package making the request is the top-level, we can offer nicer error messages

    if (!dependencyReference) {
      if (dependencyReference === null) {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `You seem to be requiring a peer dependency ("${dependencyName}"), but it is not installed (which might be because you're the top-level package)`,
            {request, issuer, dependencyName}
          );
        } else {
          throw makeError(
            `MISSING_PEER_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" is trying to access a peer dependency ("${dependencyName}") that should be provided by its direct ancestor but isn't`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName}
          );
        }
      } else {
        if (issuerLocator === topLevelLocator) {
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `You cannot require a package ("${dependencyName}") that is not declared in your dependencies (via "${issuer}")`,
            {request, issuer, dependencyName}
          );
        } else {
          const candidates = Array.from(issuerInformation.packageDependencies.keys());
          throw makeError(
            `UNDECLARED_DEPENDENCY`,
            `Package "${issuerLocator.name}@${issuerLocator.reference}" (via "${issuer}") is trying to require the package "${dependencyName}" (via "${request}") without it being listed in its dependencies (${candidates.join(
              `, `
            )})`,
            {request, issuer, issuerLocator: Object.assign({}, issuerLocator), dependencyName, candidates}
          );
        }
      }
    }

    // We need to check that the package exists on the filesystem, because it might not have been installed

    const dependencyLocator = {name: dependencyName, reference: dependencyReference};
    const dependencyInformation = exports.getPackageInformation(dependencyLocator);
    const dependencyLocation = path.resolve(__dirname, dependencyInformation.packageLocation);

    if (!dependencyLocation) {
      throw makeError(
        `MISSING_DEPENDENCY`,
        `Package "${dependencyLocator.name}@${dependencyLocator.reference}" is a valid dependency, but hasn't been installed and thus cannot be required (it might be caused if you install a partial tree, such as on production environments)`,
        {request, issuer, dependencyLocator: Object.assign({}, dependencyLocator)}
      );
    }

    // Now that we know which package we should resolve to, we only have to find out the file location

    if (subPath) {
      unqualifiedPath = path.resolve(dependencyLocation, subPath);
    } else {
      unqualifiedPath = dependencyLocation;
    }
  }

  return path.normalize(unqualifiedPath);
};

/**
 * Transforms an unqualified path into a qualified path by using the Node resolution algorithm (which automatically
 * appends ".js" / ".json", and transforms directory accesses into "index.js").
 */

exports.resolveUnqualified = function resolveUnqualified(
  unqualifiedPath,
  {extensions = Object.keys(Module._extensions)} = {}
) {
  const qualifiedPath = applyNodeExtensionResolution(unqualifiedPath, {extensions});

  if (qualifiedPath) {
    return path.normalize(qualifiedPath);
  } else {
    throw makeError(
      `QUALIFIED_PATH_RESOLUTION_FAILED`,
      `Couldn't find a suitable Node resolution for unqualified path "${unqualifiedPath}"`,
      {unqualifiedPath}
    );
  }
};

/**
 * Transforms a request into a fully qualified path.
 *
 * Note that it is extremely important that the `issuer` path ends with a forward slash if the issuer is to be
 * treated as a folder (ie. "/tmp/foo/" rather than "/tmp/foo" if "foo" is a directory). Otherwise relative
 * imports won't be computed correctly (they'll get resolved relative to "/tmp/" instead of "/tmp/foo/").
 */

exports.resolveRequest = function resolveRequest(request, issuer, {considerBuiltins, extensions} = {}) {
  let unqualifiedPath;

  try {
    unqualifiedPath = exports.resolveToUnqualified(request, issuer, {considerBuiltins});
  } catch (originalError) {
    // If we get a BUILTIN_NODE_RESOLUTION_FAIL error there, it means that we've had to use the builtin node
    // resolution, which usually shouldn't happen. It might be because the user is trying to require something
    // from a path loaded through a symlink (which is not possible, because we need something normalized to
    // figure out which package is making the require call), so we try to make the same request using a fully
    // resolved issuer and throws a better and more actionable error if it works.
    if (originalError.code === `BUILTIN_NODE_RESOLUTION_FAIL`) {
      let realIssuer;

      try {
        realIssuer = realpathSync(issuer);
      } catch (error) {}

      if (realIssuer) {
        if (issuer.endsWith(`/`)) {
          realIssuer = realIssuer.replace(/\/?$/, `/`);
        }

        try {
          exports.resolveToUnqualified(request, realIssuer, {considerBuiltins});
        } catch (error) {
          // If an error was thrown, the problem doesn't seem to come from a path not being normalized, so we
          // can just throw the original error which was legit.
          throw originalError;
        }

        // If we reach this stage, it means that resolveToUnqualified didn't fail when using the fully resolved
        // file path, which is very likely caused by a module being invoked through Node with a path not being
        // correctly normalized (ie you should use "node $(realpath script.js)" instead of "node script.js").
        throw makeError(
          `SYMLINKED_PATH_DETECTED`,
          `A pnp module ("${request}") has been required from what seems to be a symlinked path ("${issuer}"). This is not possible, you must ensure that your modules are invoked through their fully resolved path on the filesystem (in this case "${realIssuer}").`,
          {
            request,
            issuer,
            realIssuer,
          }
        );
      }
    }
    throw originalError;
  }

  if (unqualifiedPath === null) {
    return null;
  }

  try {
    return exports.resolveUnqualified(unqualifiedPath, {extensions});
  } catch (resolutionError) {
    if (resolutionError.code === 'QUALIFIED_PATH_RESOLUTION_FAILED') {
      Object.assign(resolutionError.data, {request, issuer});
    }
    throw resolutionError;
  }
};

/**
 * Setups the hook into the Node environment.
 *
 * From this point on, any call to `require()` will go through the "resolveRequest" function, and the result will
 * be used as path of the file to load.
 */

exports.setup = function setup() {
  // A small note: we don't replace the cache here (and instead use the native one). This is an effort to not
  // break code similar to "delete require.cache[require.resolve(FOO)]", where FOO is a package located outside
  // of the Yarn dependency tree. In this case, we defer the load to the native loader. If we were to replace the
  // cache by our own, the native loader would populate its own cache, which wouldn't be exposed anymore, so the
  // delete call would be broken.

  const originalModuleLoad = Module._load;

  Module._load = function(request, parent, isMain) {
    if (!enableNativeHooks) {
      return originalModuleLoad.call(Module, request, parent, isMain);
    }

    // Builtins are managed by the regular Node loader

    if (builtinModules.has(request)) {
      try {
        enableNativeHooks = false;
        return originalModuleLoad.call(Module, request, parent, isMain);
      } finally {
        enableNativeHooks = true;
      }
    }

    // The 'pnpapi' name is reserved to return the PnP api currently in use by the program

    if (request === `pnpapi`) {
      return pnpModule.exports;
    }

    // Request `Module._resolveFilename` (ie. `resolveRequest`) to tell us which file we should load

    const modulePath = Module._resolveFilename(request, parent, isMain);

    // Check if the module has already been created for the given file

    const cacheEntry = Module._cache[modulePath];

    if (cacheEntry) {
      return cacheEntry.exports;
    }

    // Create a new module and store it into the cache

    const module = new Module(modulePath, parent);
    Module._cache[modulePath] = module;

    // The main module is exposed as global variable

    if (isMain) {
      process.mainModule = module;
      module.id = '.';
    }

    // Try to load the module, and remove it from the cache if it fails

    let hasThrown = true;

    try {
      module.load(modulePath);
      hasThrown = false;
    } finally {
      if (hasThrown) {
        delete Module._cache[modulePath];
      }
    }

    // Some modules might have to be patched for compatibility purposes

    for (const [filter, patchFn] of patchedModules) {
      if (filter.test(request)) {
        module.exports = patchFn(exports.findPackageLocator(parent.filename), module.exports);
      }
    }

    return module.exports;
  };

  const originalModuleResolveFilename = Module._resolveFilename;

  Module._resolveFilename = function(request, parent, isMain, options) {
    if (!enableNativeHooks) {
      return originalModuleResolveFilename.call(Module, request, parent, isMain, options);
    }

    let issuers;

    if (options) {
      const optionNames = new Set(Object.keys(options));
      optionNames.delete('paths');

      if (optionNames.size > 0) {
        throw makeError(
          `UNSUPPORTED`,
          `Some options passed to require() aren't supported by PnP yet (${Array.from(optionNames).join(', ')})`
        );
      }

      if (options.paths) {
        issuers = options.paths.map(entry => `${path.normalize(entry)}/`);
      }
    }

    if (!issuers) {
      const issuerModule = getIssuerModule(parent);
      const issuer = issuerModule ? issuerModule.filename : `${process.cwd()}/`;

      issuers = [issuer];
    }

    let firstError;

    for (const issuer of issuers) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, issuer);
      } catch (error) {
        firstError = firstError || error;
        continue;
      }

      return resolution !== null ? resolution : request;
    }

    throw firstError;
  };

  const originalFindPath = Module._findPath;

  Module._findPath = function(request, paths, isMain) {
    if (!enableNativeHooks) {
      return originalFindPath.call(Module, request, paths, isMain);
    }

    for (const path of paths || []) {
      let resolution;

      try {
        resolution = exports.resolveRequest(request, path);
      } catch (error) {
        continue;
      }

      if (resolution) {
        return resolution;
      }
    }

    return false;
  };

  process.versions.pnp = String(exports.VERSIONS.std);
};

exports.setupCompatibilityLayer = () => {
  // ESLint currently doesn't have any portable way for shared configs to specify their own
  // plugins that should be used (https://github.com/eslint/eslint/issues/10125). This will
  // likely get fixed at some point, but it'll take time and in the meantime we'll just add
  // additional fallback entries for common shared configs.

  for (const name of [`react-scripts`]) {
    const packageInformationStore = packageInformationStores.get(name);
    if (packageInformationStore) {
      for (const reference of packageInformationStore.keys()) {
        fallbackLocators.push({name, reference});
      }
    }
  }

  // Modern versions of `resolve` support a specific entry point that custom resolvers can use
  // to inject a specific resolution logic without having to patch the whole package.
  //
  // Cf: https://github.com/browserify/resolve/pull/174

  patchedModules.push([
    /^\.\/normalize-options\.js$/,
    (issuer, normalizeOptions) => {
      if (!issuer || issuer.name !== 'resolve') {
        return normalizeOptions;
      }

      return (request, opts) => {
        opts = opts || {};

        if (opts.forceNodeResolution) {
          return opts;
        }

        opts.preserveSymlinks = true;
        opts.paths = function(request, basedir, getNodeModulesDir, opts) {
          // Extract the name of the package being requested (1=full name, 2=scope name, 3=local name)
          const parts = request.match(/^((?:(@[^\/]+)\/)?([^\/]+))/);

          // make sure that basedir ends with a slash
          if (basedir.charAt(basedir.length - 1) !== '/') {
            basedir = path.join(basedir, '/');
          }
          // This is guaranteed to return the path to the "package.json" file from the given package
          const manifestPath = exports.resolveToUnqualified(`${parts[1]}/package.json`, basedir);

          // The first dirname strips the package.json, the second strips the local named folder
          let nodeModules = path.dirname(path.dirname(manifestPath));

          // Strips the scope named folder if needed
          if (parts[2]) {
            nodeModules = path.dirname(nodeModules);
          }

          return [nodeModules];
        };

        return opts;
      };
    },
  ]);
};

if (module.parent && module.parent.id === 'internal/preload') {
  exports.setupCompatibilityLayer();

  exports.setup();
}

if (process.mainModule === module) {
  exports.setupCompatibilityLayer();

  const reportError = (code, message, data) => {
    process.stdout.write(`${JSON.stringify([{code, message, data}, null])}\n`);
  };

  const reportSuccess = resolution => {
    process.stdout.write(`${JSON.stringify([null, resolution])}\n`);
  };

  const processResolution = (request, issuer) => {
    try {
      reportSuccess(exports.resolveRequest(request, issuer));
    } catch (error) {
      reportError(error.code, error.message, error.data);
    }
  };

  const processRequest = data => {
    try {
      const [request, issuer] = JSON.parse(data);
      processResolution(request, issuer);
    } catch (error) {
      reportError(`INVALID_JSON`, error.message, error.data);
    }
  };

  if (process.argv.length > 2) {
    if (process.argv.length !== 4) {
      process.stderr.write(`Usage: ${process.argv[0]} ${process.argv[1]} <request> <issuer>\n`);
      process.exitCode = 64; /* EX_USAGE */
    } else {
      processResolution(process.argv[2], process.argv[3]);
    }
  } else {
    let buffer = '';
    const decoder = new StringDecoder.StringDecoder();

    process.stdin.on('data', chunk => {
      buffer += decoder.write(chunk);

      do {
        const index = buffer.indexOf('\n');
        if (index === -1) {
          break;
        }

        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        processRequest(line);
      } while (true);
    });
  }
}
