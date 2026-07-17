"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "@/lib/auth";

export const CHRONCHAOS_AUTH_CHANGE_EVENT = "chronchaos-auth-change";

export function ChronChaosNav() {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [loginOpen, setLoginOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notificationCount, setNotificationCount] = useState(0);

  const refreshUser = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" });
      const payload = await response.json() as { user?: SessionUser | null };
      setUser(response.ok ? payload.user ?? null : null);
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    void refreshUser();
    const refresh = () => { void refreshUser(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(CHRONCHAOS_AUTH_CHANGE_EVENT, refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener(CHRONCHAOS_AUTH_CHANGE_EVENT, refresh);
    };
  }, [refreshUser]);

  useEffect(() => {
    if (!user) {
      setNotificationCount(0);
      return;
    }
    void fetch("/api/notifications", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { totalCount?: number } | null) => setNotificationCount(payload?.totalCount ?? 0))
      .catch(() => setNotificationCount(0));
  }, [user]);

  async function login() {
    if (!username.trim() || !password) {
      setMessage("请输入用户名和密码");
      return;
    }
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username.trim(), password }),
    });
    const payload = await response.json().catch(() => ({})) as { user?: SessionUser; error?: string };
    if (!response.ok || !payload.user) {
      setMessage(payload.error || "登录失败");
      setBusy(false);
      return;
    }
    setUser(payload.user);
    setLoginOpen(false);
    setUsername("");
    setPassword("");
    setBusy(false);
    window.dispatchEvent(new Event(CHRONCHAOS_AUTH_CHANGE_EVENT));
  }

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setUserMenuOpen(false);
    setBusy(false);
    window.dispatchEvent(new Event(CHRONCHAOS_AUTH_CHANGE_EVENT));
  }

  return (
    <>
      <header className="chron-topbar">
        <div className="chron-brand-group">
          <a className="chron-brand" href="/" aria-label="返回 ChronChaos 读者书库">
            <BookIcon />
            <span>ChronChaos</span>
          </a>
          <button
            className="chron-guide-trigger"
            type="button"
            aria-expanded={guideOpen}
            onClick={() => setGuideOpen((open) => !open)}
          >
            <MapIcon />
            导览
          </button>
          {guideOpen && (
            <div className="chron-guide-menu">
              <a href="/">Reader Library</a>
              <a href="/character-graph">人物关系图谱</a>
              <a href="/studio">Author Studio</a>
              <a href="/messages?compose=1">帮助与反馈</a>
            </div>
          )}
        </div>

        <nav className="chron-topnav" aria-label="ChronChaos 主导航">
          <a href="/">Reader Library</a>
          <a href="/studio">Author Studio</a>
          <a aria-current="page" href="/character-graph">Multiverse</a>
        </nav>

        <div className="chron-auth-nav">
          {user === undefined ? <span className="chron-auth-loading">账号载入中…</span> : null}
          {user === null ? (
            <>
              <button className={loginOpen ? "active" : ""} type="button" onClick={() => setLoginOpen((open) => !open)}>
                登录
              </button>
              <a className="chron-register-link" href="/">注册</a>
              {loginOpen && (
                <div className="chron-popover chron-login-popover">
                  <strong>登录 ChronChaos</strong>
                  <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名" />
                  <input
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={(event) => { if (event.key === "Enter") void login(); }}
                    placeholder="密码"
                    type="password"
                  />
                  <button className="chron-primary-button" disabled={busy} type="button" onClick={() => void login()}>
                    {busy ? "登录中…" : "登录"}
                  </button>
                  <a className="chron-register-tip" href="/">没有账号？前往主站注册</a>
                  {message ? <p className="chron-error">{message}</p> : null}
                </div>
              )}
            </>
          ) : null}
          {user ? (
            <>
              <a
                aria-label={`消息通知${notificationCount > 0 ? `，${notificationCount} 条待处理` : ""}`}
                className="chron-notification-bell"
                href="/messages"
                title="消息通知"
              >
                <BellIcon />
                {notificationCount > 0 ? <span>{notificationCount > 99 ? "99+" : notificationCount}</span> : null}
              </a>
              <button
                aria-expanded={userMenuOpen}
                className="chron-user-button"
                onClick={() => setUserMenuOpen((open) => !open)}
                type="button"
              >
                <span className="chron-avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
                <span>{user.displayName}</span>
                <ChevronIcon />
              </button>
              {userMenuOpen && (
                <div className="chron-popover chron-user-menu">
                  <button type="button" onClick={() => { setUpgradeOpen(true); setUserMenuOpen(false); }}>
                    <CrownIcon />升级用户
                  </button>
                  <button disabled={busy} type="button" onClick={() => void logout()}>
                    <LogoutIcon />退出登录
                  </button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </header>
      {upgradeOpen ? <UpgradeDialog onClose={() => setUpgradeOpen(false)} /> : null}
    </>
  );
}

function UpgradeDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="chron-upgrade-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className="chron-upgrade-modal" role="dialog" aria-modal="true" aria-label="升级账号权限">
        <div className="chron-upgrade-head">
          <div>
            <span>升级账号权限</span>
            <strong>选择 Pro 或 Max 权限</strong>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}>×</button>
        </div>
        <div className="chron-plan-grid">
          <Plan name="普通用户" badge="当前基础权限" features={["每天评论 20 条", "每天听书 1 章", "每天生成图片 3 张", "不能生成视频"]} disabled />
          <Plan name="Pro" badge="最受欢迎" price="99" features={["每天评论 50 条", "每天听书 5 章", "每天生成图片 10 张", "每天生成视频 1 段"]} featured />
          <Plan name="Max" badge="最大管饱" price="199" features={["每天评论 100 条", "每天任意章节听书", "每天生成图片 20 张", "每天生成视频 5 段"]} />
        </div>
        <a className="chron-upgrade-contact" href="/messages?compose=1#support-messages">联系管理员升级</a>
      </section>
    </div>
  );
}

function Plan({ name, badge, price, features, disabled, featured }: {
  name: string; badge: string; price?: string; features: string[]; disabled?: boolean; featured?: boolean;
}) {
  return (
    <article className={`chron-plan${featured ? " featured" : ""}${disabled ? " disabled" : ""}`}>
      <div><h3>{name}</h3><span>{badge}</span></div>
      {price ? <p><strong>￥{price}</strong>/月</p> : <p>基础账号</p>}
      <ul>{features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul>
    </article>
  );
}

function Icon({ children, size = 20 }: { children: React.ReactNode; size?: number }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
}
function BookIcon() { return <Icon size={21}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5z" /></Icon>; }
function MapIcon() { return <Icon size={17}><path d="m3 6 5-2 8 2 5-2v14l-5 2-8-2-5 2z" /><path d="M8 4v14M16 6v14" /></Icon>; }
function BellIcon() { return <Icon size={18}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></Icon>; }
function ChevronIcon() { return <Icon size={15}><path d="m8 10 4 4 4-4" /></Icon>; }
function CrownIcon() { return <Icon size={17}><path d="m3 7 4 4 5-7 5 7 4-4-2 11H5z" /></Icon>; }
function LogoutIcon() { return <Icon size={17}><path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6" /></Icon>; }
