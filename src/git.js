import fs from 'fs';
import { execFileSync } from 'child_process';

export function git(cwd, ...args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function gitWithInput(args: string[], input: string) {
  return execFileSync('git', args, { input, encoding: 'utf8' });
}

export default function getRepoPath(repo, branch, subdir, workingDir) {
  if (!fs.existsSync(workingDir)) {
    git(null, 'clone', '--filter=blob:none', '--no-checkout', repo, workingDir);
    git(workingDir, 'sparse-checkout', 'init', '--cone');
    git(workingDir, 'sparse-checkout', 'set', subdir);
  }
  git(workingDir, 'checkout', branch);
  git(workingDir, 'pull');
  const hash = git(workingDir, 'ls-tree', 'HEAD', subdir);
  const match = hash.match(/^\S+\s+\S+\s+(\S+)\s*/);
  return match[1];
}
