/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import assert from 'assert';
import minimist from 'minimist';
import StringResolver from './index';
import { gitFetchDirsByBranch } from './git';

const argv = minimist(process.argv.slice(2), {
  boolean: ['ios', 'android', 'help'],
});

const USAGE = `
Usage:

  npx @gasbuddy/string-resolver [--code] --config=[strings.config.js] <--ios|--android> <--version=1.2.3>

Build a strings file by going through the content_directory combining all the strings,
running any rules and version limits, and generate platform-specific (--ios or --android)
strings files and optionally generated code (--code). See README.md for an example configuration file.

`;

if (argv.help) {
  console.log(USAGE);
  process.exit(0);
}

// eslint-disable-next-line import/no-dynamic-require
const rawConfig = require(path.resolve(argv.config));
const config = rawConfig.default || rawConfig.config || rawConfig;

(async () => {
  try {
    assert(argv.ios || argv.android, 'iOS or Android format must be specified with --ios or --android');
    assert(argv.version, 'App version must be specified with --version=x.y.z');

    let finalConfig;
    if (typeof config === 'function') {
      finalConfig = await config(argv);
    } else {
      finalConfig = {
        platform: argv.ios ? StringResolver.IOS : StringResolver.ANDROID,
        version: argv.version,
        ...config,
      };
    }

    assert(config.output, 'String output file or directory must be specified in config file');
    assert(config.cultures, 'Must specify target cultures for the strings file in the config file');
    assert(config.content.path, 'Content directory or git information  must be specified in config file');

    const resolver = new StringResolver(finalConfig);

    let localPath = finalConfig.content.path;
    if (finalConfig.content.repo) {
      const { content } = finalConfig;
      gitFetchDirsByBranch(
        `git@github.com:${content.repo}`,
        content.branch, {
          [finalConfig.content.path]: '.strings-content',
        },
      );
      localPath = '.strings-content';
    }
    fs.readdirSync(localPath)
      .filter(f => f.endsWith('.json'))
      .map(f => fs.readFileSync(path.join(localPath, f), 'utf8'))
      .map(j => JSON.parse(j))
      .map(j => resolver.addEntry(j));

    if (argv.code) {
      await resolver.buildClass(finalConfig.output.code, finalConfig.cultures[0]);
    }
    resolver.writeStringsFiles(
      finalConfig.cultures,
      finalConfig.baseCulture || finalConfig.cultures[0],
      finalConfig.output.strings,
    );
  } catch (error) {
    console.log(USAGE);
    console.error(`Failed to generate file:
${error.message}
`);
    console.error(error);
    process.exit(-1);
  }
})();
