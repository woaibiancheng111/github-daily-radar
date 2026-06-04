import "dotenv/config";
import cors from "cors";
import express from "express";
import * as cheerio from "cheerio";
import OpenAI from "openai";

const app = express();
const port = Number(process.env.PORT || 3001);
const trendCache = new Map();
const analysisCache = new Map();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const dashscope = process.env.DASHSCOPE_API_KEY
  ? new OpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY,
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
    })
  : null;

const languages = [
  "All",
  "JavaScript",
  "TypeScript",
  "Python",
  "Go",
  "Rust",
  "Java",
  "C++",
  "C#",
  "PHP",
  "Swift",
  "Kotlin",
  "Shell"
];

function normalizeText(value) {
  return value.replace(/\s+/g, " ").trim();
}

function parseNumber(value) {
  const match = value.replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function cacheKey(...parts) {
  return parts.map((part) => String(part || "all").toLowerCase()).join(":");
}

function githubTrendingUrl(language, since) {
  const safeLanguage = language && language !== "All" ? encodeURIComponent(language) : "";
  const suffix = safeLanguage ? `/${safeLanguage}` : "";
  return `https://github.com/trending${suffix}?since=${encodeURIComponent(since || "daily")}`;
}

function dateDaysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function rangeForSince(since) {
  if (since === "monthly") return dateDaysAgo(30);
  if (since === "weekly") return dateDaysAgo(7);
  return dateDaysAgo(1);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, headers = {}) {
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "github-daily-radar/0.1",
      Accept: "text/html,application/json,text/plain,*/*",
      ...headers
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed ${response.status} for ${url}`);
  }

  return response.text();
}

async function fetchGitHubSearch(language = "All", since = "daily") {
  const createdAfter = rangeForSince(since);
  const languageQuery = language && language !== "All" ? ` language:${language}` : "";
  const query = encodeURIComponent(`created:>=${createdAfter}${languageQuery}`);
  const url = `https://api.github.com/search/repositories?q=${query}&sort=stars&order=desc&per_page=25`;
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": "github-daily-radar/0.1",
      Accept: "application/vnd.github+json"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub Search API failed ${response.status}`);
  }

  const payload = await response.json();
  return (payload.items || []).map((item, index) => ({
    id: item.full_name,
    rank: index + 1,
    owner: item.owner?.login,
    name: item.name,
    fullName: item.full_name,
    url: item.html_url,
    description: item.description || "",
    language: item.language || "Unknown",
    stars: item.stargazers_count || 0,
    forks: item.forks_count || 0,
    todayStars: item.stargazers_count || 0,
    todayText: `created since ${createdAfter}`,
    builtBy: []
  }));
}

async function fetchTrending(language = "All", since = "daily") {
  const key = cacheKey("trending", language, since);
  const cached = trendCache.get(key);
  if (cached && Date.now() - cached.createdAt < 1000 * 60 * 10) {
    return cached.data;
  }

  let repositories = [];
  let source = "github-trending";

  try {
    const html = await fetchText(githubTrendingUrl(language, since));
    const $ = cheerio.load(html);

    $("article.Box-row").each((index, element) => {
      const root = $(element);
      const repoLink = root.find("h2 a").first();
      const repoPath = normalizeText(repoLink.text()).replace(/\s+/g, "");
      const [owner, name] = repoPath.split("/");
      const description = normalizeText(root.find("p").first().text());
      const languageText = normalizeText(root.find("[itemprop='programmingLanguage']").first().text());
      const starsText = normalizeText(root.find("a[href$='/stargazers']").first().text());
      const forksText = normalizeText(root.find("a[href$='/forks']").first().text());
      const todayText = normalizeText(root.find("span.float-sm-right").first().text());
      const builtBy = root
        .find("span:contains('Built by') a img")
        .map((_, image) => $(image).attr("alt")?.replace(/^@/, ""))
        .get()
        .filter(Boolean)
        .slice(0, 5);

      if (!owner || !name) {
        return;
      }

      repositories.push({
        id: `${owner}/${name}`,
        rank: index + 1,
        owner,
        name,
        fullName: `${owner}/${name}`,
        url: `https://github.com/${owner}/${name}`,
        description,
        language: languageText || "Unknown",
        stars: parseNumber(starsText),
        forks: parseNumber(forksText),
        todayStars: parseNumber(todayText),
        todayText,
        builtBy
      });
    });
  } catch {
    repositories = await fetchGitHubSearch(language, since);
    source = "github-search";
  }

  const data = {
    language,
    since,
    source,
    fetchedAt: new Date().toISOString(),
    repositories
  };
  trendCache.set(key, { createdAt: Date.now(), data });
  return data;
}

async function fetchRepoReadme(owner, repo) {
  const candidates = ["README.md", "readme.md", "README.MD"];
  for (const file of candidates) {
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${file}`;
    try {
      return await fetchText(url, { Accept: "text/plain,*/*" });
    } catch {
      // Try the next common README casing.
    }
  }
  return "";
}

function fallbackAnalysis(repo, readme) {
  const source = `${repo.description || ""}\n${readme.slice(0, 1200)}`;
  const hasCli = /\bcli\b|command line|terminal/i.test(source);
  const hasAi = /\bai\b|llm|agent|model|rag|inference/i.test(source);
  const hasWeb = /\bweb\b|react|vue|next|browser|frontend|dashboard/i.test(source);
  const tags = [
    hasAi && "AI",
    hasWeb && "Web",
    hasCli && "CLI",
    repo.language !== "Unknown" && repo.language
  ].filter(Boolean);

  return {
    summary: repo.description || "README 暂不可用，建议打开仓库继续查看。",
    useCases: [
      hasAi ? "适合评估 AI 工具链、模型应用或自动化工作流。" : "适合快速了解该领域近期受关注的新项目。",
      hasWeb ? "可以重点查看 demo、部署方式和前端交互设计。" : "可以重点查看 README、示例代码和 issue 活跃度。"
    ],
    techStack: tags.length ? tags : [repo.language],
    whyTrending: `今日新增星标约 ${repo.todayStars || 0}，当前总星标 ${repo.stars || 0}。`,
    risks: ["这是本地规则摘要；配置 DASHSCOPE_API_KEY 后可获得更完整的中文分析。"]
  };
}

async function analyzeWithDashScope(repo, readme) {
  if (!dashscope) {
    return fallbackAnalysis(repo, readme);
  }

  const completion = await dashscope.chat.completions.create({
    model: process.env.DASHSCOPE_MODEL || "qwen-plus",
    temperature: 0.25,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "你是资深开源项目分析师。请用简洁中文分析 GitHub 仓库，输出 JSON，字段为 summary、useCases、techStack、whyTrending、risks。useCases、techStack、risks 是字符串数组。"
      },
      {
        role: "user",
        content: JSON.stringify({
          repository: repo,
          readme: readme.slice(0, 9000)
        })
      }
    ]
  });

  const content = completion.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

app.get("/api/languages", (_request, response) => {
  response.json({ languages });
});

app.get("/api/trending", async (request, response) => {
  try {
    const data = await fetchTrending(request.query.language || "All", request.query.since || "daily");
    response.json(data);
  } catch (error) {
    response.status(502).json({ message: error.message });
  }
});

app.post("/api/analyze", async (request, response) => {
  const repo = request.body?.repo;
  if (!repo?.owner || !repo?.name) {
    response.status(400).json({ message: "Missing repo owner or name." });
    return;
  }

  const key = cacheKey("analysis", repo.owner, repo.name);
  const cached = analysisCache.get(key);
  if (cached) {
    response.json(cached);
    return;
  }

  try {
    const readme = await fetchRepoReadme(repo.owner, repo.name);
    const analysis = await analyzeWithDashScope(repo, readme);
    const data = {
      repo: repo.fullName || `${repo.owner}/${repo.name}`,
      analyzedAt: new Date().toISOString(),
      usedDashScope: Boolean(dashscope),
      analysis
    };
    analysisCache.set(key, data);
    response.json(data);
  } catch (error) {
    response.status(502).json({ message: error.message });
  }
});

app.listen(port, () => {
  console.log(`GitHub Daily Radar API listening on http://localhost:${port}`);
});
