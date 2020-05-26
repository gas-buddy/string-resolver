#!/usr/bin/env node
/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import minimist from 'minimist';
import gitShallow from 'git-shallow';
import StringResolver from './index';

const argv = minimist(process.argv.slice(2));

const USAGE = `
Usage:

  npm -p @gasbuddy/string-resolver string-resolver-diff <repo> <path> <before_hash_or_branch> <after_hash_or_branch>

Show the difference between two git hashes or branches in a repo.

`;

if (argv.help) {
  console.log(USAGE);
  process.exit(0);
}

(async () => {
  let beforePath;
  let afterPath;

  try {
    const [repo, repoPath, beforeRef, afterRef] = argv._;
    gitShallow({
      repositoryUrl: `git@github.com:${repo}`,
      branch: beforeRef,
      repositoryPath: repoPath,
      workingDirectory: path.join('.diff-content', beforeRef),
    });
    beforePath = path.join('.diff-content', beforeRef, repoPath);
    gitShallow({
      repositoryUrl: `git@github.com:${repo}`,
      branch: afterRef,
      repositoryPath: repoPath,
      workingDirectory: path.join('.diff-content', afterRef),
    });
    afterPath = path.join('.diff-content', afterRef, repoPath);

    const beforeContent = fs.readdirSync(beforePath)
      .filter(f => f.endsWith('.json'))
      .map(f => fs.readFileSync(path.join(beforePath, f), 'utf8'))
      .map(j => JSON.parse(j));
    const afterContent = fs.readdirSync(afterPath)
      .filter(f => f.endsWith('.json'))
      .map(f => fs.readFileSync(path.join(afterPath, f), 'utf8'))
      .map(j => JSON.parse(j));

    const changed = StringResolver.changeDetail(beforeContent, afterContent);
    const diff = StringResolver.computeChanges(changed, argv.platform || 'ios', argv.version || '1.0.0');
    console.log(JSON.stringify(diff, null, '\t'));
  } catch (error) {
    console.log(USAGE);
    console.error(`Failed to generate diff:
${error.message}
`, error);
    process.exit(-1);
  }
})();
