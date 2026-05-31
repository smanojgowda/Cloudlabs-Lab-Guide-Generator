/**
 * Git Service — clone, pull, branch, commit, push, and create PRs
 * Uses simple-git for local operations and GitHub REST API for PRs.
 */
import simpleGit from 'simple-git';
import { resolve } from 'path';
import { existsSync, mkdirSync } from 'fs';
import config from '../config.js';
import logger from '../utils/logger.js';

const REPOS_DIR = resolve(config.root, 'repos');
if (!existsSync(REPOS_DIR)) mkdirSync(REPOS_DIR, { recursive: true });

/**
 * Create a simple-git instance with credential manager disabled
 * to prevent the Windows "Connect to GitHub" popup.
 */
function createGit(baseDir) {
  const env = {
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_ASKPASS: '',
  };
  const opts = { baseDir, config: ['credential.helper='], env };
  return simpleGit(opts);
}

/**
 * Get the local directory for a repo.
 */
function repoDir(owner, repo) {
  return resolve(REPOS_DIR, `${owner}--${repo}`);
}

/**
 * Clone a repo or pull if already cloned.
 * @param {{ cloneUrl: string, owner: string, repo: string, branch?: string }} opts
 * @returns {Promise<{ localPath: string, cloned: boolean }>}
 */
export async function cloneOrPull({ cloneUrl, owner, repo, branch, token }) {
  const dir = repoDir(owner, repo);

  // Build authenticated URL if token is provided (needed for private repos)
  const authUrl = token
    ? `https://${token}@github.com/${owner}/${repo}.git`
    : cloneUrl;

  if (existsSync(resolve(dir, '.git'))) {
    logger.info(`[Git] Repo exists, pulling latest: ${dir}`);
    const git = createGit(dir);
    // Update remote URL in case token changed
    try { await git.remote(['set-url', 'origin', authUrl]); } catch {}
    try { await git.fetch('origin', ['--depth', '1']); } catch {}
    if (branch) {
      try { await git.checkout(branch); } catch {
        try { await git.checkoutBranch(branch, `origin/${branch}`); } catch {}
      }
    }
    try { await git.pull('origin', branch || 'main'); } catch {}
    return { localPath: dir, cloned: false };
  }

  logger.info(`[Git] Cloning ${owner}/${repo} → ${dir}`);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const git = createGit();
  const cloneArgs = ['--depth', '1'];
  if (branch) cloneArgs.push('--branch', branch);
  try {
    await git.clone(authUrl, dir, cloneArgs);
  } catch (err) {
    // Git returns non-zero for warnings like case-collisions on Windows.
    // If .git exists after the attempt, the clone actually succeeded.
    if (!existsSync(resolve(dir, '.git'))) throw err;
    logger.warn(`[Git] Clone completed with warnings: ${err.message}`);
  }
  return { localPath: dir, cloned: true };
}

/**
 * Create a new branch from the current HEAD.
 * @param {string} localPath
 * @param {string} branchName
 */
export async function createBranch(localPath, branchName) {
  const git = createGit(localPath);
  const current = await git.revparse(['--abbrev-ref', 'HEAD']);
  try {
    await git.checkoutLocalBranch(branchName);
  } catch {
    // Branch may already exist
    await git.checkout(branchName);
  }
  logger.info(`[Git] Created/switched to branch: ${branchName} (from ${current.trim()})`);
  return branchName;
}

/**
 * Stage, commit, and push changes.
 * @param {string} localPath
 * @param {string} message — commit message
 * @param {string} [branch] — branch to push (defaults to current)
 */
export async function commitAndPush(localPath, message, branch) {
  const git = createGit(localPath);
  await git.add('.');
  const status = await git.status();
  if (status.files.length === 0) {
    logger.info('[Git] No changes to commit.');
    return { committed: false, pushed: false };
  }
  await git.commit(message);
  const currentBranch = branch || (await git.revparse(['--abbrev-ref', 'HEAD'])).trim();
  // Unshallow if needed — shallow clones can't push new branches
  try { await git.fetch(['--unshallow']); } catch {}
  await git.push('origin', currentBranch, ['--set-upstream']);
  logger.info(`[Git] Committed and pushed to ${currentBranch}: "${message}"`);
  return { committed: true, pushed: true, branch: currentBranch };
}

/**
 * Get the status of the working tree.
 * @param {string} localPath
 */
export async function getStatus(localPath) {
  const git = createGit(localPath);
  const status = await git.status();
  return {
    branch: status.current,
    modified: status.modified,
    created: status.created,
    deleted: status.deleted,
    renamed: status.renamed,
    staged: status.staged,
    files: status.files.map(f => ({ path: f.path, status: f.working_dir })),
    isClean: status.isClean(),
  };
}

/**
 * Create a Pull Request via GitHub REST API.
 * Requires a personal access token.
 * @param {{ owner: string, repo: string, title: string, body: string, head: string, base: string, token: string }} opts
 */
export async function createPullRequest({ owner, repo, title, body, head, base, token }) {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title, body, head, base }),
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(`GitHub PR creation failed: ${err.message || JSON.stringify(err)}`);
  }
  const pr = await resp.json();
  logger.info(`[Git] PR created: ${pr.html_url}`);
  return { url: pr.html_url, number: pr.number, title: pr.title };
}

/**
 * Get the diff summary (files changed).
 * @param {string} localPath
 */
export async function getDiffSummary(localPath) {
  const git = createGit(localPath);
  const diff = await git.diffSummary();
  return {
    files: diff.files.map(f => ({
      file: f.file,
      changes: f.changes,
      insertions: f.insertions,
      deletions: f.deletions,
    })),
    insertions: diff.insertions,
    deletions: diff.deletions,
  };
}

export { REPOS_DIR, repoDir };
