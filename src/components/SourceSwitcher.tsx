import { useEffect, useState } from "react";
import { connectLocalFolder } from "../lib/localSource";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";

export function SourceSwitcher({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loginMsg, setLoginMsg] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setLoggedIn(!!session)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleConnectLocal() {
    const ok = await connectLocalFolder();
    if (ok) onChange();
  }

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    // Magic link：不需要密码、不需要在这个站里实现注册表单。
    //
    // emailRedirectTo 显式传当前 origin，不依赖后台那个全局 Site URL——
    // Site URL 只能填一个值，本地开发（localhost:5180）和以后部署上线的域名
    // 不可能同时满足；传 origin 就是"从哪来跳回哪去"。前提是这个地址在
    // Dashboard → Authentication → URL Configuration 的 Redirect URLs
    // 白名单里，否则 Supabase 会忽略它、静默回落到 Site URL。
    setLoginMsg("发送中…");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setLoginMsg("✗ " + error.message);
      return;
    }
    setLoginMsg("");
    setSent(true);
  }

  // 给同一个账号加一个密码，专门供 jd-insight 扩展登录用。
  // 扩展那边走 grant_type=password 而不是魔法链接——魔法链接的回调
  // 要跳回 chrome-extension:// 页面，在 MV3 里成本远高于收益。
  // 同一个 auth.users，RLS 按 auth.uid() 判断，跟登录方式无关。
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (pwd.length < 8) {
      setPwdMsg("密码至少 8 位。");
      return;
    }
    setPwdMsg("设置中…");
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setPwdMsg(error ? "✗ " + error.message : "✓ 已设置，去扩展设置页用邮箱+这个密码登录。");
    if (!error) setPwd("");
  }

  async function handleSignOut() {
    await supabase?.auth.signOut();
    onChange();
  }

  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="badge"
        style={{ cursor: "pointer", border: "1px solid var(--rule)", background: "var(--card)", color: "var(--ink2)" }}
      >
        切换数据源 ▾
      </button>
      {open && (
        <div
          className="card"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 6px)",
            width: 260,
            padding: 14,
            zIndex: 10,
            fontSize: 12.5,
          }}
        >
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>本地文件</p>
          <p style={{ margin: "0 0 8px", color: "var(--muted)" }}>
            选择 jd-insight/data/ 文件夹，读取导出的 jd_backup.json。
          </p>
          <button onClick={handleConnectLocal} style={{ width: "100%", marginBottom: 14 }}>
            选择文件夹
          </button>

          {supabaseConfigured ? (
            <>
              <p style={{ margin: "0 0 8px", fontWeight: 600 }}>真实数据（云端）</p>
              {sent ? (
                <p style={{ color: "var(--ok)" }}>登录链接已发到邮箱，点开即可。</p>
              ) : (
                <form onSubmit={handleMagicLink} style={{ display: "grid", gap: 8 }}>
                  <input
                    type="email"
                    required
                    placeholder="邮箱"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    style={{ padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 4, background: "var(--paper)", color: "var(--ink)" }}
                  />
                  <button type="submit">发送登录链接</button>
                </form>
              )}
              {loginMsg && (
                <p
                  style={{
                    margin: "6px 0 0",
                    color: loginMsg.startsWith("✗") ? "var(--stop)" : "var(--muted)",
                  }}
                >
                  {loginMsg}
                </p>
              )}
              {loggedIn && (
                <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px dashed var(--rule)" }}>
                  <p style={{ margin: "0 0 6px", fontWeight: 600 }}>设置同步密码</p>
                  <p style={{ margin: "0 0 8px", color: "var(--muted)" }}>
                    只用于 jd-insight 扩展登录同步。设一次就够。
                  </p>
                  <form onSubmit={handleSetPassword} style={{ display: "grid", gap: 8 }}>
                    <input
                      type="password"
                      placeholder="至少 8 位"
                      value={pwd}
                      onChange={(e) => setPwd(e.target.value)}
                      style={{ padding: "6px 8px", border: "1px solid var(--rule)", borderRadius: 4, background: "var(--paper)", color: "var(--ink)" }}
                    />
                    <button type="submit">设置密码</button>
                  </form>
                  {pwdMsg && (
                    <p style={{ margin: "6px 0 0", color: pwdMsg.startsWith("✗") ? "var(--stop)" : "var(--ok)" }}>
                      {pwdMsg}
                    </p>
                  )}
                </div>
              )}

              <button onClick={handleSignOut} style={{ marginTop: 8, width: "100%", background: "transparent", border: "1px solid var(--rule)", color: "var(--ink2)" }}>
                退出登录
              </button>
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>云端同步未配置（缺 Supabase 环境变量）。</p>
          )}
        </div>
      )}
    </div>
  );
}
