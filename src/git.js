/**
 * Cribbed from https://github.com/krisselden/git-sparse-checkout
 * with BSD2:
 *
BSD 2-CLAUSE LICENSE

Copyright 2018 Kris Selden and Contributors. All Rights Reserved.
Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
disclaimer in the documentation and/or other materials provided with the distribution.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES,
INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY,
WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */
import { execFileSync } from 'child_process';

// eslint-disable-next-line no-control-regex
const LS_TREE_FORMAT = /(\d+) (commit|tree|blob|tag) ([0-9A-Za-z]+)\t([^\u0000]+)\u0000/g;
const LS_REMOTE_FORMAT = /([0-9A-Za-z]+)\t([^\n]+)\n/g;
const FETCH_PACK_FORMAT = /(?:pack|keep)\t([0-9A-Za-z]+)/g;
const CAT_FILE_TYPE = /(commit|tree|blob|tag)\n/g;
// eslint-disable-next-line no-control-regex
const LS_FILES = /([^\u0000]+)\u0000/g;

function parseRows(regex: RegExp, out: string) {
  // eslint-disable-next-line no-undef
  let match: RegExpExecArray | null;
  const rows = [];
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(out)) !== null) {
    const row = [];
    for (let i = 1; i < match.length; i += 1) {
      row.push(match[i]);
    }
    rows.push(row);
  }
  return rows;
}

function parseRow(regex: RegExp, out: string) {
  const rows = parseRows(regex, out);
  return rows.length > 0 ? rows[0] : [];
}

export function git(...args: string[]) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

export function gitWithInput(args: string[], input: string) {
  return execFileSync('git', args, { input, encoding: 'utf8' });
}

function startsWith(file: string, prefixes: string[]) {
  for (let i = 0; i < prefixes.length; i += 1) {
    if (file.lastIndexOf(prefixes[i], 0) === 0) {
      return true;
    }
  }
  return false;
}

function findCachedFiles(prefixes: string[]) {
  const out = git('ls-files', '--cached', '-z');
  const files = parseRows(LS_FILES, out).map(([file]) => file);
  return files.filter(file => startsWith(file, prefixes));
}

function shaType(sha: string) {
  const out = git('cat-file', '-t', sha);
  const [type] = parseRow(CAT_FILE_TYPE, out);
  return type;
}

function isCommit(sha: string) {
  try {
    return shaType(sha) === 'commit';
  } catch (e) {
    return false;
  }
}

function resolveRemoteTag(
  repoUrl: string,
  tagName: string,
): string | undefined {
  const out = git('ls-remote', '--exit-code', '--tags', repoUrl, tagName);
  const [tagSha] = parseRow(LS_REMOTE_FORMAT, out);
  return tagSha;
}

function resolveRemoteBranch(
  repoUrl: string,
  branch: string,
): string | undefined {
  const out = git('ls-remote', '--exit-code', '--refs', repoUrl, branch);
  const [tagSha] = parseRow(LS_REMOTE_FORMAT, out);
  return tagSha;
}

function fetchPack(repoUrl: string, commitSha: string) {
  const out = git('fetch-pack', '--keep', '--depth=1', repoUrl, commitSha);
  const [packSha] = parseRow(FETCH_PACK_FORMAT, out);
  return packSha;
}

function findTreeShas(commitSha: string, treePaths: string[]) {
  const out = git('ls-tree', '-z', '-d', commitSha, ...treePaths);
  const rows = parseRows(LS_TREE_FORMAT, out);
  const shas: {
    [path: string]: string;
  } = {};
  rows.forEach(([, , sha, path]) => {
    shas[path] = sha;
  });
  return shas;
}

function fetchTagCommit(repoUrl: string, tagName: string) {
  const commitSha = resolveRemoteTag(repoUrl, tagName);
  if (commitSha === undefined) {
    throw new Error(`failed to resolve tag ${tagName} in ${repoUrl}`);
  }
  // fetch if we don't have already
  if (!isCommit(commitSha)) {
    fetchPack(repoUrl, commitSha);
  }
  return commitSha;
}

function fetchBranchCommit(repoUrl: string, branchName: string) {
  const commitSha = resolveRemoteBranch(repoUrl, branchName);
  if (commitSha === undefined) {
    throw new Error(`failed to resolve branch ${branchName} in ${repoUrl}`);
  }
  // fetch if we don't have already
  if (!isCommit(commitSha)) {
    fetchPack(repoUrl, commitSha);
  }
  return commitSha;
}

function readTree(treeSha: string, prefix: string) {
  git('read-tree', '--prefix', prefix, treeSha);
}

function checkoutIndex(paths: string[]) {
  gitWithInput(['checkout-index', '-z', '--stdin'], paths.join('\u0000'));
}

function gitReset(prefixes: string[]) {
  git('reset', '--', ...prefixes);
}

/**
 * Looks up the tag sha from the remote url, fetches it if not already
 * fetched, then reads the specified tree paths from the commit into
 * the index mapped to the specified prefixes, and checks out the index,
 * then resets the index.
 *
 * @param repoUrl the repository url
 * @param tagName the tag name
 * @param treePrefixMap a map of path in the commit to a target prefix
 */
export function gitFetchDirsByTag(
  repoUrl: string,
  tagName: string,
  treePrefixMap: { [path: string]: string },
) {
  const commitSha = fetchTagCommit(repoUrl, tagName);
  const treePaths = Object.keys(treePrefixMap);
  const treeShas = findTreeShas(commitSha, treePaths);
  // read trees into the index with the mapped prefixes
  treePaths.forEach((treePath) => {
    const treeSha = treeShas[treePath];
    const prefix = treePrefixMap[treePath];
    readTree(treeSha, prefix);
  });
  // just in case stuff is already in the index only checkout and
  // reset stuff starting with the prefixes
  const prefixes = treePaths.map(treePath => treePrefixMap[treePath]);
  const files = findCachedFiles(prefixes);
  checkoutIndex(files);
  gitReset(prefixes);
}

export function gitFetchDirsByBranch(
  repoUrl: string,
  branchName: string,
  treePrefixMap: { [path: string]: string },
) {
  const commitSha = fetchBranchCommit(repoUrl, branchName);
  const treePaths = Object.keys(treePrefixMap);
  const treeShas = findTreeShas(commitSha, treePaths);
  // read trees into the index with the mapped prefixes
  treePaths.forEach((treePath) => {
    const treeSha = treeShas[treePath];
    const prefix = treePrefixMap[treePath];
    readTree(treeSha, prefix);
  });
  // just in case stuff is already in the index only checkout and
  // reset stuff starting with the prefixes
  const prefixes = treePaths.map(treePath => treePrefixMap[treePath]);
  const files = findCachedFiles(prefixes);
  checkoutIndex(files);
  gitReset(prefixes);
}
