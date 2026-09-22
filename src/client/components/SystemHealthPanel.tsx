import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Database, Gauge, RefreshCw, Server, X } from "lucide-react";

import type { BookDetails } from "../../shared/auto-novel";
import type { AutoNovelApi, AutoNovelRunDetails } from "../auto-novel-api";
import { apiClient } from "../api/client";
import type { DatabaseStatus } from "../../shared/contracts";
import type { UsageSummary } from "../../shared/authoring";

interface SystemHealthPanelProps {
  book: BookDetails;
  run: AutoNovelRunDetails | null;
  api: AutoNovelApi;
  onClose: () => void;
}

interface Readiness {
  status: "ready" | "not_ready" | "unknown";
  checks?: { database?: boolean; worker?: boolean };
}

export function SystemHealthPanel({ book, run, api, onClose }: SystemHealthPanelProps) {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [database, setDatabase] = useState<DatabaseStatus | null>(null);
  const [readiness, setReadiness] = useState<Readiness>({ status: "unknown" });
  const [issueCount, setIssueCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [nextUsage, consistency, nextDatabase, nextReadiness] = await Promise.all([
        api.getUsageSummary(),
        api.checkConsistency(book.book.id),
        apiClient.platform === "desktop" ? apiClient.getDatabaseStatus() : Promise.resolve(null),
        apiClient.platform === "web" ? fetch("/api/ready").then(async (response) => (response.ok ? await response.json() as Readiness : { status: "not_ready" as const })) : Promise.resolve({ status: "ready" as const }),
      ]);
      setUsage(nextUsage);
      setIssueCount(consistency.issues.filter((issue) => issue.severity !== "info").length);
      setDatabase(nextDatabase);
      setReadiness(nextReadiness);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "系统健康检查失败。" );
    } finally {
      setBusy(false);
    }
  }, [api, book.book.id]);

  useEffect(() => { void load(); }, [load]);

  const ready = readiness.status === "ready" && issueCount === 0;
  return (
    <aside className="story-drawer system-health-drawer" aria-label="系统健康检查">
      <div className="memory-drawer-header">
        <div><span className="eyebrow">SYSTEM HEALTH</span><h2>系统健康</h2><p className="story-drawer-subtitle">把作品一致性、服务就绪、用量和本地数据状态放在同一处检查。</p></div>
        <button className="icon-button" type="button" aria-label="关闭系统健康检查" onClick={onClose}><X size={18} /></button>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <section className={`system-health-hero${ready ? " is-ready" : " is-attention"}`}>
        <span className="system-health-hero-icon">{ready ? <CheckCircle2 size={22} /> : <AlertTriangle size={22} />}</span>
        <div><strong>{ready ? "系统状态良好" : "有项目需要关注"}</strong><small>{busy ? "正在检查…" : readiness.status === "ready" ? "服务已就绪，当前作品没有高优先级一致性问题。" : "服务尚未完全就绪，请检查本地服务或生产任务。"}</small></div>
      </section>
      <div className="system-health-grid">
        <HealthMetric icon={Server} label="服务就绪" value={readiness.status === "ready" ? "正常" : readiness.status === "not_ready" ? "未就绪" : "未知"} tone={readiness.status === "ready" ? "success" : "warning"} />
        <HealthMetric icon={Activity} label="生产任务" value={run?.run.status ?? "待开始"} tone={run?.run.status === "failed" ? "danger" : "accent"} />
        <HealthMetric icon={AlertTriangle} label="一致性提示" value={`${issueCount} 条`} tone={issueCount === 0 ? "success" : "warning"} />
        <HealthMetric icon={Gauge} label="本周期 Token" value={usage?.totalTokens.toLocaleString("zh-CN") ?? "—"} tone="neutral" />
      </div>
      <section className="system-health-detail" aria-label="健康详情">
        <div><span><Database size={14} /> 数据库</span><strong>{database ? `备份 ${database.backupCount ?? 0} 份` : apiClient.platform === "web" ? "浏览器会话" : "检查中"}</strong></div>
        <div><span><Gauge size={14} /> 费用估算</span><strong>{usage ? `¥${(usage.estimatedCostMicros / 100_000_000).toFixed(4)}` : "—"}</strong></div>
        <div><span><Activity size={14} /> 当前作品</span><strong>{book.book.title}</strong></div>
      </section>
      <button className="secondary-button system-health-refresh" type="button" disabled={busy} onClick={() => void load()}><RefreshCw size={14} />{busy ? "检查中…" : "重新检查"}</button>
    </aside>
  );
}

function HealthMetric({ icon: Icon, label, value, tone }: { icon: typeof Activity; label: string; value: string; tone: "success" | "warning" | "danger" | "accent" | "neutral" }) {
  return <div className={`system-health-metric tone-${tone}`}><Icon size={15} /><span><small>{label}</small><strong>{value}</strong></span></div>;
}
