import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  BarChart3,
  BookOpenText,
  ExternalLink,
  Flame,
  Github,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star
} from "lucide-react";
import "./styles.css";

const sinceOptions = [
  { value: "daily", label: "今日" },
  { value: "weekly", label: "本周" },
  { value: "monthly", label: "本月" }
];

function numberFormat(value) {
  return new Intl.NumberFormat("en-US", { notation: value > 9999 ? "compact" : "standard" }).format(value || 0);
}

function dataSourceLabel(source) {
  return source === "github-search" ? "GitHub Search 备用排序" : "GitHub Trending";
}

function updateTimeLabel(fetchedAt) {
  return fetchedAt ? `更新 ${new Date(fetchedAt).toLocaleTimeString()}` : "等待更新";
}

function App() {
  const [repositories, setRepositories] = useState([]);
  const [language, setLanguage] = useState("All");
  const [since, setSince] = useState("daily");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loadingTrend, setLoadingTrend] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [error, setError] = useState("");
  const [fetchedAt, setFetchedAt] = useState("");
  const [source, setSource] = useState("");

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

  async function loadTrending() {
    setLoadingTrend(true);
    setError("");
    try {
      const response = await fetch(`/api/trending?language=${encodeURIComponent(language)}&since=${since}`);
      if (!response.ok) {
        throw new Error("GitHub 榜单读取失败");
      }
      const data = await response.json();
      setRepositories(data.repositories || []);
      setFetchedAt(data.fetchedAt);
      setSource(data.source || "github-trending");
      setSelected(data.repositories?.[0] || null);
      setAnalysis(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingTrend(false);
    }
  }

  async function loadAnalysis(repo) {
    if (!repo) return;
    setLoadingAnalysis(true);
    setAnalysis(null);
    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo })
      });
      if (!response.ok) {
        throw new Error("DashScope 分析失败");
      }
      const data = await response.json();
      setAnalysis(data);
    } catch (requestError) {
      setAnalysis({
        usedDashScope: false,
        analysis: {
          summary: requestError.message,
          useCases: [],
          techStack: [],
          whyTrending: "暂时无法生成分析。",
          risks: ["请检查网络、DashScope Key 或服务端日志。"]
        }
      });
    } finally {
      setLoadingAnalysis(false);
    }
  }

  useEffect(() => {
    loadTrending();
  }, [language, since]);

  useEffect(() => {
    loadAnalysis(selected);
  }, [selected?.id]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return repositories;
    return repositories.filter((repo) =>
      [repo.fullName, repo.description, repo.language].join(" ").toLowerCase().includes(keyword)
    );
  }, [repositories, query]);

  const totalTodayStars = repositories.reduce((sum, repo) => sum + repo.todayStars, 0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <Github size={24} />
          </div>
          <div>
            <h1>GitHub Daily Radar</h1>
            <p>每日开源趋势和中文洞察</p>
          </div>
        </div>

        <div className="sidebar-note">
          <Sparkles size={18} />
          <span>聚合趋势仓库、README 与 DashScope 分析，快速判断项目值得看在哪里。</span>
        </div>

        <div className="control-group">
          <label>周期</label>
          <div className="segmented">
            {sinceOptions.map((option) => (
              <button
                key={option.value}
                className={since === option.value ? "active" : ""}
                onClick={() => setSince(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <label htmlFor="language">语言</label>
          <select id="language" value={language} onChange={(event) => setLanguage(event.target.value)}>
            {languages.map((item) => (
              <option key={item} value={item}>
                {item === "All" ? "全部语言" : item}
              </option>
            ))}
          </select>
        </div>

        <button className="refresh" onClick={loadTrending} type="button">
          <RefreshCw size={18} />
          刷新榜单
        </button>

        <div className="stats">
          <div>
            <span>{repositories.length}</span>
            <p>入榜仓库</p>
          </div>
          <div>
            <span>{numberFormat(totalTodayStars)}</span>
            <p>周期新增星标</p>
          </div>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Trending repositories</p>
            <h2>{language === "All" ? "全部语言" : language} 榜单</h2>
          </div>
          <div className="topbar-actions">
            <div className="source-pill">
              <BarChart3 size={16} />
              <span>{dataSourceLabel(source)}</span>
            </div>
            <div className="source-pill muted">
              <Activity size={16} />
              <span>{updateTimeLabel(fetchedAt)}</span>
            </div>
            <div className="search-box">
              <Search size={18} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索仓库、描述或语言" />
            </div>
          </div>
        </header>

        <section className="insight-strip">
          <div>
            <span className="metric-icon warm">
              <Flame size={18} />
            </span>
            <p>周期新增星标</p>
            <strong>{numberFormat(totalTodayStars)}</strong>
          </div>
          <div>
            <span className="metric-icon cool">
              <Github size={18} />
            </span>
            <p>当前显示</p>
            <strong>{filtered.length}</strong>
          </div>
          <div>
            <span className="metric-icon green">
              <Activity size={18} />
            </span>
            <p>分析对象</p>
            <strong>{selected?.fullName || "等待选择"}</strong>
          </div>
        </section>

        {error && <div className="error">{error}</div>}

        <div className="workspace">
          <section className="repo-list" aria-busy={loadingTrend}>
            {loadingTrend ? (
              <div className="empty-state">
                <Loader2 className="spin" size={28} />
                <span>正在读取 GitHub Trending</span>
              </div>
            ) : (
              filtered.map((repo) => (
                <button
                  key={repo.id}
                  className={`repo-row ${selected?.id === repo.id ? "selected" : ""}`}
                  onClick={() => setSelected(repo)}
                  type="button"
                >
                  <span className="rank">#{repo.rank}</span>
                  <div className="repo-main">
                    <div className="repo-title">
                      <strong>{repo.fullName}</strong>
                      <span>{repo.language}</span>
                    </div>
                    <p>{repo.description || "这个仓库暂时没有公开描述。"}</p>
                    <div className="repo-meta">
                      <span>
                        <Star size={14} /> {numberFormat(repo.stars)}
                      </span>
                      <span>
                        <Activity size={14} /> {repo.todayText || `${repo.todayStars} stars today`}
                      </span>
                    </div>
                  </div>
                  <span className="row-arrow">查看</span>
                </button>
              ))
            )}
          </section>

          <aside className="analysis-panel">
            {selected ? (
              <>
                <div className="panel-head">
                  <div>
                    <p className="eyebrow">DashScope insight</p>
                    <h3>{selected.fullName}</h3>
                  </div>
                  <a href={selected.url} target="_blank" rel="noreferrer" title="打开 GitHub 仓库">
                    <ExternalLink size={18} />
                  </a>
                </div>

                {loadingAnalysis ? (
                  <div className="empty-state compact">
                    <Loader2 className="spin" size={26} />
                    <span>正在分析 README 和仓库信息</span>
                  </div>
                ) : (
                  <AnalysisContent analysis={analysis?.analysis} usedDashScope={analysis?.usedDashScope} />
                )}
              </>
            ) : (
              <div className="empty-state compact">
                <BookOpenText size={28} />
                <span>选择一个仓库查看分析</span>
              </div>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}

function AnalysisContent({ analysis, usedDashScope }) {
  if (!analysis) return null;
  const useCases = Array.isArray(analysis.useCases) ? analysis.useCases : [];
  const techStack = Array.isArray(analysis.techStack) ? analysis.techStack : [];
  const risks = Array.isArray(analysis.risks) ? analysis.risks : [];

  return (
    <div className="analysis-body">
      <div className="source-badge">
        <Sparkles size={16} />
        {usedDashScope ? "DashScope 生成" : "本地摘要"}
      </div>
      <section>
        <h4>它是做什么的</h4>
        <p>{analysis.summary}</p>
      </section>
      <section>
        <h4>适合关注</h4>
        <ul>
          {useCases.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <section>
        <h4>技术栈</h4>
        <div className="chips">
          {techStack.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>
      <section>
        <h4>为什么上榜</h4>
        <p>{analysis.whyTrending}</p>
      </section>
      <section>
        <h4>查看前注意</h4>
        <ul>
          {risks.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
