import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, Sparkles, UserRound } from "lucide-react";

import { PasswordSchema, RegisterAccountInputSchema, UsernameSchema } from "../../shared/auth";

export type AuthMode = "login" | "register";
export type AuthStatus = "idle" | "submitting" | "success";

interface AuthGateProps {
  mode: AuthMode;
  status: AuthStatus;
  username: string;
  password: string;
  invitationCode: string;
  error: string | null;
  onModeChange: (mode: AuthMode) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onInvitationCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AuthGate({
  mode,
  status,
  username,
  password,
  invitationCode,
  error,
  onModeChange,
  onUsernameChange,
  onPasswordChange,
  onInvitationCodeChange,
  onSubmit,
}: AuthGateProps) {
  const usernameRef = useRef<HTMLInputElement>(null);
  const [showPassword, setShowPassword] = useState(false);
  const isRegister = mode === "register";
  const usernameValid = UsernameSchema.safeParse(username.trim()).success;
  const passwordValid = PasswordSchema.safeParse(password).success;
  const invitationValid = RegisterAccountInputSchema.shape.inviteCode.safeParse(invitationCode.trim()).success;
  const passwordChecks = [
    { label: "至少 12 位", valid: password.length >= 12 },
    { label: "包含数字", valid: /\d/.test(password) },
    { label: "包含符号", valid: /[^\p{L}\p{N}]/u.test(password) },
  ];
  const passwordScore = passwordChecks.filter((check) => check.valid).length;
  const canSubmit = usernameValid && passwordValid && (!isRegister || invitationValid);

  useEffect(() => {
    usernameRef.current?.focus();
    setShowPassword(false);
  }, [mode]);

  return (
    <main className="auth-gate" aria-labelledby="auth-title">
      <div className="auth-gate-shell">
        <aside className="auth-gate-rail" aria-label="工作台介绍">
          <div className="auth-gate-brand">
            <span className="brand-mark" aria-hidden="true">奕</span>
            <span>小奕小说工作台</span>
          </div>
          <div className="auth-gate-rail-copy">
            <span className="auth-gate-kicker"><Sparkles size={14} /> 作者入口</span>
            <h1>让想法，<br />有地方继续长大。</h1>
            <p>登录后，你的故事、方向和候选正文都会留在自己的本地工作台里。</p>
          </div>
          <ol className="auth-gate-steps" aria-label="工作台流程">
            <li className="is-active"><span>01</span><div><strong>留下想法</strong><small>从一句话开始</small></div></li>
            <li><span>02</span><div><strong>选择方向</strong><small>保留作者决定权</small></div></li>
            <li><span>03</span><div><strong>审阅成稿</strong><small>候选通过后再入正文</small></div></li>
          </ol>
        </aside>

        <section className="auth-gate-card">
          <header className="auth-gate-header">
            <div>
              <span className="auth-gate-kicker">{isRegister ? "创建作者账号" : "欢迎回来"}</span>
              <h2 id="auth-title">{isRegister ? "注册工作台" : "登录工作台"}</h2>
            </div>
            <span className="auth-security-note"><LockKeyhole size={14} /> 会话级凭据</span>
          </header>

          <div className="auth-mode-switch" role="group" aria-label="账号操作">
            <button type="button" aria-pressed={!isRegister} className={!isRegister ? "is-active" : ""} onClick={() => onModeChange("login")}>
              登录
            </button>
            <button type="button" aria-pressed={isRegister} className={isRegister ? "is-active" : ""} onClick={() => onModeChange("register")}>
              {isRegister ? "已有账号，返回登录" : "没有账号？使用邀请码注册"}
            </button>
          </div>

          <p className="auth-gate-intro">
            {isRegister ? "用管理员的邀请码创建账号，注册成功后会自动进入工作台。" : "输入账号即可继续整理你的作品，登录信息只在当前会话中使用。"}
          </p>

          <form className="auth-form" onSubmit={onSubmit} noValidate>
            <div className="auth-field">
              <label htmlFor="auth-username"><UserRound size={15} /> 用户名</label>
              <input
                ref={usernameRef}
                id="auth-username"
                type="text"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                placeholder="用户名"
                autoComplete="username"
                aria-invalid={Boolean(username) && !usernameValid}
                aria-describedby="auth-username-hint"
                disabled={status !== "idle"}
              />
              <span id="auth-username-hint" className={`auth-field-hint${username && !usernameValid ? " is-error" : ""}`}>
                {username && !usernameValid ? "3–32 位字母、数字或 . _ -，可使用中文。" : "3–32 位，之后可在本地作品中识别作者。"}
              </span>
            </div>

            <div className="auth-field">
              <label htmlFor="auth-password"><KeyRound size={15} /> 密码</label>
              <div className="auth-password-wrap">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => onPasswordChange(event.target.value)}
                  placeholder="密码（至少 12 位）"
                  autoComplete={isRegister ? "new-password" : "current-password"}
                  aria-invalid={Boolean(password) && !passwordValid}
                  aria-describedby={isRegister ? "auth-password-hint auth-password-strength" : "auth-password-hint"}
                  disabled={status !== "idle"}
                />
                <button className="auth-password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "隐藏密码" : "显示密码"} disabled={status !== "idle"}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <span id="auth-password-hint" className={`auth-field-hint${password && !passwordValid ? " is-error" : ""}`}>
                {password && !passwordValid ? "密码至少需要 12 位。" : "密码不会写入作品库或公开响应。"}
              </span>
              {isRegister ? (
                <div id="auth-password-strength" className="auth-password-strength" aria-live="polite">
                  <div className="auth-strength-bar" aria-hidden="true"><span style={{ width: `${Math.max(1, passwordScore) * 33.333}%` }} /></div>
                  <span>{password ? (passwordScore === 3 ? "密码强度足够" : "再加强一点会更稳妥") : "密码强度提示"}</span>
                  <div className="auth-strength-checks">
                    {passwordChecks.map((check) => <span className={check.valid ? "is-valid" : ""} key={check.label}>{check.valid ? <Check size={12} /> : <span className="auth-strength-dot" />} {check.label}</span>)}
                  </div>
                </div>
              ) : null}
            </div>

            {isRegister ? (
              <div className="auth-field">
                <label htmlFor="auth-invitation"><LockKeyhole size={15} /> 邀请码 <span>注册所需</span></label>
                <input
                  id="auth-invitation"
                  type="text"
                  value={invitationCode}
                  onChange={(event) => onInvitationCodeChange(event.target.value)}
                  placeholder="邀请码"
                  autoComplete="off"
                  aria-invalid={Boolean(invitationCode) && !invitationValid}
                  aria-describedby="auth-invitation-hint"
                  disabled={status !== "idle"}
                />
                <span id="auth-invitation-hint" className={`auth-field-hint${invitationCode && !invitationValid ? " is-error" : ""}`}>
                  {invitationCode && !invitationValid ? "邀请码至少需要 8 个字符。" : "邀请码只用于创建账号，不会替代登录密码。"}
                </span>
              </div>
            ) : null}

            {error ? <p className="auth-form-error" role="alert">{error}</p> : null}
            <button className="auth-submit-button" type="submit" disabled={status !== "idle" || !canSubmit}>
              {status === "submitting" ? <><LoaderCircle className="auth-spinner" size={17} /> 正在验证…</> : status === "success" ? <><Check size={17} /> 验证成功，正在进入</> : <>{isRegister ? "注册并登录" : "进入工作台"}<ArrowRight size={17} /></>}
            </button>
          </form>

          <footer className="auth-gate-footer">
            <span><span className="auth-status-dot" /> 本地优先 · 作者掌控正文</span>
            <span>{isRegister ? "已有账号？切换到登录" : "还没有账号？使用邀请码注册"}</span>
          </footer>
        </section>
      </div>
    </main>
  );
}
