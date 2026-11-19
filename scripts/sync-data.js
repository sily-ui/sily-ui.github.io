// 由 GitHub Actions 定时运行：拉取 GitHub 数据 → 写入 data.json（页面只读此文件，无额度限制）
const fs = require('fs');
const path = require('path');

const USER = 'sily-ui';
const HEADERS = {
  'User-Agent': 'sily-ui-pages-sync',
  Accept: 'application/vnd.github+json'
};
// Actions 环境用 GITHUB_TOKEN（1000 次/小时），本地运行可省略（60 次/小时）
if (process.env.GH_TOKEN || process.env.GITHUB_TOKEN) {
  HEADERS.Authorization = `Bearer ${process.env.GH_TOKEN || process.env.GITHUB_TOKEN}`;
}

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${url} -> ${res.status} ${res.statusText}`);
  return res.json();
}

// 只保留页面用到的字段，减小 data.json 体积
function trimRepo(r) {
  return {
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    homepage: r.homepage || null,
    description: r.description || '',
    language: r.language,
    stargazers_count: r.stargazers_count,
    forks_count: r.forks_count,
    fork: r.fork,
    private: r.private,
    archived: r.archived,
    pushed_at: r.pushed_at,
    topics: r.topics || []
  };
}

function shapeCommit(c, repoName, fallbackDate) {
  return {
    sha: c.sha,
    message: c.commit?.message || '',
    author: c.commit?.author?.name || c.commit?.committer?.name || 'unknown',
    date: c.commit?.author?.date || c.commit?.committer?.date || fallbackDate,
    repo: repoName,
    url: c.html_url
  };
}

(async () => {
  const user = await get(`https://api.github.com/users/${USER}`);
  const reposRaw = await get(`https://api.github.com/users/${USER}/repos?sort=updated&per_page=100&type=owner`);
  const repos = reposRaw
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .map(trimRepo);

  // 前 8 个最近活跃仓库，各取 5 条 commit（共 8 次调用，远低于额度）
  const commits = [];
  for (const r of repos.slice(0, 8)) {
    try {
      const cs = await get(`https://api.github.com/repos/${USER}/${r.name}/commits?per_page=5`);
      cs.forEach(c => commits.push(shapeCommit(c, r.name, r.pushed_at)));
    } catch (e) {
      console.warn(`skip commits of ${r.name}: ${e.message}`);
    }
  }
  commits.sort((a, b) => new Date(b.date) - new Date(a.date));

  const data = {
    updatedAt: new Date().toISOString(),
    user: {
      login: user.login,
      name: user.name,
      avatar_url: user.avatar_url,
      bio: user.bio,
      location: user.location,
      blog: user.blog,
      html_url: user.html_url,
      public_repos: user.public_repos,
      followers: user.followers,
      following: user.following
    },
    repos,
    commits: commits.slice(0, 24)
  };

  const out = path.join(__dirname, '..', 'data.json');
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`data.json written: ${repos.length} repos, ${Math.min(commits.length, 24)} commits, updatedAt=${data.updatedAt}`);
})().catch(e => { console.error(e); process.exit(1); });
