/**
 * Masterdoc Parser — fetches and parses CloudLabs masterdoc.json
 *
 * Masterdoc format:
 * [{ Name, Language, Files: [{ RawFilePath, Order }] }]
 *
 * This module fetches the JSON, resolves each file's raw GitHub URL
 * to a local repo path, and downloads the markdown content.
 */

/**
 * Fetch and parse a masterdoc.json URL.
 * @param {string} masterdocUrl — raw GitHub URL to masterdoc.json
 * @returns {Promise<object>} — { name, language, files: [{ rawUrl, order, repoPath, filename }] }
 */
export async function parseMasterdoc(masterdocUrl) {
  const resp = await fetch(masterdocUrl);
  if (!resp.ok) throw new Error(`Failed to fetch masterdoc: ${resp.status} ${resp.statusText}`);
  const data = await resp.json();

  // masterdoc.json is an array of labs (usually one)
  const lab = Array.isArray(data) ? data[0] : data;
  if (!lab || !lab.Files) throw new Error('Invalid masterdoc format — no Files array found');

  const files = lab.Files
    .sort((a, b) => (a.Order || 0) - (b.Order || 0))
    .map(f => {
      const rawUrl = f.RawFilePath;
      // Extract repo-relative path from raw GitHub URL
      // e.g. https://raw.githubusercontent.com/org/repo/branch/path/to/file.md → path/to/file.md
      const repoPath = extractRepoPath(rawUrl);
      const filename = repoPath.split('/').pop();
      return { rawUrl, order: f.Order, repoPath, filename };
    });

  return {
    name: lab.Name || 'Untitled Lab',
    language: lab.Language || 'English',
    files,
  };
}

/**
 * Extract the repo-relative file path from a raw GitHub URL.
 * Handles both /refs/heads/branch/ and /branch/ formats.
 */
function extractRepoPath(rawUrl) {
  try {
    const url = new URL(rawUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    // Format: /owner/repo/refs/heads/branch/path...  OR  /owner/repo/branch/path...
    const refsIdx = parts.indexOf('refs');
    if (refsIdx !== -1 && parts[refsIdx + 1] === 'heads') {
      // /owner/repo/refs/heads/branch/path...
      return parts.slice(refsIdx + 3).join('/');
    }
    // /owner/repo/branch/path...
    return parts.slice(3).join('/');
  } catch {
    return rawUrl.split('/').pop() || 'unknown.md';
  }
}

/**
 * Fetch the markdown content of each file in the masterdoc.
 * @param {Array} files — from parseMasterdoc().files
 * @returns {Promise<Array>} — files with added `content` field
 */
export async function fetchMasterdocFiles(files) {
  const results = await Promise.all(
    files.map(async (f) => {
      try {
        const resp = await fetch(f.rawUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const content = await resp.text();
        return { ...f, content, error: null };
      } catch (err) {
        return { ...f, content: null, error: err.message };
      }
    })
  );
  return results;
}

/**
 * Parse a GitHub repo URL to extract owner, repo, and default branch.
 * @param {string} githubUrl — e.g. https://github.com/org/repo
 * @returns {{ owner: string, repo: string, cloneUrl: string }}
 */
export function parseGitHubUrl(githubUrl) {
  try {
    const url = new URL(githubUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length < 2) throw new Error('Invalid GitHub URL');
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, '');
    return {
      owner,
      repo,
      cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
  } catch (err) {
    throw new Error(`Cannot parse GitHub URL: ${err.message}`);
  }
}

/**
 * Extract the branch name from a masterdoc raw URL.
 * @param {string} masterdocUrl
 * @returns {string} branch name (defaults to 'main')
 */
export function extractBranch(masterdocUrl) {
  try {
    const url = new URL(masterdocUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const refsIdx = parts.indexOf('refs');
    if (refsIdx !== -1 && parts[refsIdx + 1] === 'heads') {
      return parts[refsIdx + 2] || 'main';
    }
    // /owner/repo/branch/path...
    return parts[2] || 'main';
  } catch {
    return 'main';
  }
}
