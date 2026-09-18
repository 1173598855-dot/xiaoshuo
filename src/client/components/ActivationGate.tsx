import type { FormEvent } from "react";
import { ArrowRight, KeyRound, LoaderCircle, ShieldCheck, Sparkles } from "lucide-react";

import type { AuthStatus } from "./AuthGate";

interface ActivationGateProps {
  code: string;
  status: AuthStatus;
  retryAfterSeconds?: number;
  error: string | null;
  onCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function ActivationGate({ code, status, retryAfterSeconds = 0, error, onCodeChange, onSubmit }: ActivationGateProps) {
  return (
    <main className="auth-gate" aria-labelledby="activation-title">
      <div className="auth-gate-shell activation-gate-shell">
        <aside className="auth-gate-rail" aria-label="桌面端激活说明">
          <div className="auth-gate-brand">
            <span className="brand-mark" aria-hidden="true">奕</span>
            <span>小奕小说工作台</span>
          </div>
          <div className="auth-gate-rail-copy">
            <span className="auth-gate-kicker"><Sparkles size={14} /> 桌面端首次使用</span>
            <h1>先绑定设备，<br />再开始写作。</h1>
            <p>管理员邀请码只负责激活这台桌面端，账号仍然由作者自己注册和管理。</p>
          </div>
          <ol className="auth-gate-steps" aria-label="首次使用流程">
            <li className="is-active"><span>01</span><div><strong>激活设备</strong><small>绑定当前桌面端</small></div></li>
            <li><span>02</span><div><strong>创建账号</strong><small>使用邀请码注册</small></div></li>
            <li><span>03</span><div><strong>打开工作台</strong><small>开始整理作品</small></div></li>
          </ol>
        </aside>

        <section className="auth-gate-card activation-gate-card">
          <header className="auth-gate-header">
            <div>
              <span className="auth-gate-kicker">设备授权</span>
              <h2 id="activation-title">激活桌面端</h2>
            </div>
            <span className="auth-security-note"><ShieldCheck size={14} /> 本机绑定</span>
          </header>
          <p className="auth-gate-intro">输入管理员生成的邀请码。激活只绑定当前桌面端，不会直接登录任何账号。</p>
          <form className="activation-form" onSubmit={onSubmit}>
            <label htmlFor="activation-code"><KeyRound size={15} /> 桌面邀请码</label>
            <input id="activation-code" type="text" value={code} onChange={(event) => onCodeChange(event.target.value)} placeholder="输入桌面邀请码" autoComplete="off" autoFocus disabled={status !== "idle"} />
            {error ? <p className="auth-form-error" role="alert">{error}</p> : null}
            {retryAfterSeconds > 0 ? <p className="auth-rate-limit" role="status">请求保护已开启，请等待倒计时结束。</p> : null}
            <button className="auth-submit-button" type="submit" aria-label="激活" disabled={status !== "idle" || !code.trim() || retryAfterSeconds > 0}>
              {status === "submitting" ? <><LoaderCircle className="auth-spinner" size={17} /> 正在激活…</> : status === "success" ? "激活成功，继续注册" : retryAfterSeconds > 0 ? `请等待 ${retryAfterSeconds} 秒` : <>激活设备 <ArrowRight size={17} /></>}
            </button>
          </form>
          <footer className="auth-gate-footer"><span><span className="auth-status-dot" /> 邀请码不会写入作品数据</span><span>需要管理员提供邀请码</span></footer>
        </section>
      </div>
    </main>
  );
}
