/* 数据源切换 + 云端登录。
 *
 * ══════════ 登录方式：密码为主，邮件链接为备 ══════════
 *
 * ⚠️ 这里原来**只有魔法链接**，而扩展那边走的是邮箱+密码。于是真实链路是：
 *      用邮件链接登网页 → 在网页里点「设置同步密码」 → 拿这个密码去扩展登录
 *   也就是说**密码早就存在了，只是网页端自己不用它登录**。
 *   纯粹的遗留：魔法链接先写，密码是后来为扩展补的，补完没回头改网页端。
 *   结果每次上网页都要去翻邮箱，而插件一个密码就进。
 *
 * 现在反过来：密码登录是默认路径，邮件链接收进「其他方式」。
 *
 * ⚠️ 邮件链接**不能删**，它是两种情况下的唯一入口：
 *   ① 这个账号从没设过密码（当初就是用邮件链接创建的）——
 *      signInWithPassword 会直接失败，没有别的办法进来；
 *   ② 忘了密码。改密码需要先通过认证，所以必须有一条不靠密码的路。
 *
 * ⚠️ 一个报错文案上的诚实问题：Supabase 对「密码错」和「这个账号没有密码」
 *   都返回同一个 `Invalid login credentials`（刻意的，防账号枚举）。
 *   所以我**分辨不出是哪一种**，文案里必须同时给出两条出路，
 *   不能断言"你密码错了"——那会让一个从没设过密码的人一直试密码。
 */
import { useEffect, useState } from "react";
import { connectLocalFolder } from "../lib/localSource";
import { supabase, supabaseConfigured } from "../lib/supabaseClient";

/* ⚠️ 这里原来有一个 inputStyle 常量（padding / border / radius / background），
   三个输入框各自 style={inputStyle}。删掉了——因为 styles.css 里**已经有
   全局的表单样式**："下划线式输入框而不是圆角框，像在纸质表格的横线上填字"
   （1px 圆角 + 沉下去的底 + 聚焦时蓝框）。
   那个 inline 常量把这套约定整个覆盖掉了：4px 圆角、纸白底、没有聚焦态。
   于是这个浮层里的输入框和全站其他输入框长得不是一套东西。
   inline style 覆盖设计系统是最难发现的一类不一致——它不报错、
   只是看起来"差一点"。 */

type Mode = "password" | "link" | "reset";

export function SourceSwitcher({ onChange }: { onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgBad, setMsgBad] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [pwd, setPwd] = useState("");
  const [pwdMsg, setPwdMsg] = useState("");
  const [pwdBad, setPwdBad] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) =>
      setLoggedIn(!!session)
    );
    return () => sub.subscription.unsubscribe();
  }, []);

  function say(text: string, bad = false) {
    setMsg(text);
    setMsgBad(bad);
  }

  async function handleConnectLocal() {
    const ok = await connectLocalFolder();
    if (ok) onChange();
  }

  /** 默认路径：邮箱 + 密码，一次请求进去，不跳转、不翻邮箱 */
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email || !password) return;
    setBusy(true);
    say("登录中…");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (!error) {
      say("");
      setPassword("");
      onChange();
      return;
    }
    /* ⚠️ 见文件头：Supabase 不区分「密码错」和「没设过密码」。
       所以这里不能写成"密码错误"，必须把两条出路都给出来。 */
    if (/invalid login credentials/i.test(error.message)) {
      say("进不去。可能是密码不对，也可能是这个账号还没设过密码——" +
        "两种情况 Supabase 返回的是同一个错误，分不出来。" +
        "没设过密码的话用下面的「邮件链接」进来，登录后就能设。", true);
    } else if (/email not confirmed/i.test(error.message)) {
      say("这个邮箱还没验证过。先用邮件链接登录一次完成验证。", true);
    } else {
      say(error.message, true);
    }
  }

  /** 备用路径 ①：邮件链接。给"还没有密码"和"忘了密码"用 */
  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    /* emailRedirectTo 显式传当前 origin，不依赖后台那个全局 Site URL——
       Site URL 只能填一个值，本地开发（localhost:5180）和以后部署上线的域名
       不可能同时满足；传 origin 就是"从哪来跳回哪去"。前提是这个地址在
       Dashboard → Authentication → URL Configuration 的 Redirect URLs
       白名单里，否则 Supabase 会忽略它、静默回落到 Site URL。 */
    setBusy(true);
    say("发送中…");
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    say(error ? error.message : "登录链接已发到邮箱，点开即可。登录后建议在下面设个密码，以后就不用再收邮件。", !!error);
  }

  /** 备用路径 ②：忘了密码。也是发邮件，但那是重置流程的正常代价 */
  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase || !email) return;
    setBusy(true);
    say("发送中…");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setBusy(false);
    say(error ? error.message : "重置链接已发到邮箱。点开回到这个页面后，在下面「修改密码」里设新的。", !!error);
  }

  /* 给账号设/改密码。必须已登录——改密码这件事本身需要先通过认证。
     ⚠️ 文案从「设置同步密码 · 只用于 jd-insight 扩展登录」改掉了：
     现在网页端自己也用这个密码登录，它不是"扩展专用"，就是这个账号的密码。
     那句旧文案会让人以为网页端设了也没用。 */
  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    if (pwd.length < 8) {
      setPwdMsg("密码至少 8 位。");
      setPwdBad(true);
      return;
    }
    setPwdMsg("设置中…");
    setPwdBad(false);
    const { error } = await supabase.auth.updateUser({ password: pwd });
    setPwdBad(!!error);
    setPwdMsg(error ? error.message : "已设置。网页端和扩展都用邮箱 + 这个密码登录。");
    if (!error) setPwd("");
  }

  async function handleSignOut() {
    await supabase?.auth.signOut();
    say("");
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
          /* ⚠️ 原来这里挂的是 className="card" —— 而 **styles.css 里没有 .card 这个类**
             （全项目只有这一处在用它）。于是这个浮层没有底色、没有边框、没有投影：
             深色的正文压在深色侧边栏上，实测几乎读不出来。
             一个浮层必须有不透明的面，否则它不是浮层、只是一堆漂着的字。
             所以这里显式画出来，不依赖一个不存在的类。 */
          style={{
            position: "absolute",
            background: "var(--paper)",
            border: "1px solid var(--rule-strong)",
            borderRadius: 4,
            boxShadow: "0 6px 20px rgba(0,0,0,.22)",
            /* ⚠️ left 不是 right。原来写的是 right:0 —— 那是"按钮在右上角"
               时的写法，浮层从按钮右边缘往**左**展开。可这个按钮在**左侧边栏**里，
               于是 288px 宽的面板整个被推到视口外，输入框只露出一条边。
               实际跑起来才看到（截图里 "本地文件" 贴着屏幕左边缘）——
               这个 bug 在改成密码登录之前就在，只是那时面板窄一点、
               看起来像"设计得挤"而不是"跑出去了"。
               侧边栏在左，就该往右展开。 */
            left: 0,
            top: "calc(100% + 6px)",
            width: 288,
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

              {loggedIn ? (
                <>
                  <p style={{ margin: "0 0 10px", color: "var(--ok)" }}>已登录。</p>
                  <div style={{ paddingTop: 12, borderTop: "1px dashed var(--rule)" }}>
                    <p style={{ margin: "0 0 6px", fontWeight: 600 }}>修改密码</p>
                    <p style={{ margin: "0 0 8px", color: "var(--muted)" }}>
                      网页端和 jd-insight 扩展用的是同一个密码。
                    </p>
                    <form onSubmit={handleSetPassword} style={{ display: "grid", gap: 8 }}>
                      <input
                        type="password"
                        placeholder="至少 8 位"
                        value={pwd}
                        onChange={(e) => setPwd(e.target.value)}
                      />
                      <button type="submit">保存密码</button>
                    </form>
                    {pwdMsg && (
                      <p style={{ margin: "6px 0 0", color: pwdBad ? "var(--stop)" : "var(--ok)" }}>
                        {pwdMsg}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={handleSignOut}
                    style={{ marginTop: 12, width: "100%", background: "transparent", border: "1px solid var(--rule)", color: "var(--ink2)" }}
                  >
                    退出登录
                  </button>
                </>
              ) : (
                <>
                  {/* 默认就是密码表单。邮箱这一栏三种模式共用，
                      所以切换模式时不清空——切过去还得重新打一遍邮箱是纯浪费。 */}
                  <form
                    onSubmit={
                      mode === "password" ? handlePasswordLogin
                        : mode === "link" ? handleMagicLink
                        : handleReset
                    }
                    style={{ display: "grid", gap: 8 }}
                  >
                    <input
                      type="email"
                      required
                      autoComplete="username"
                      placeholder="邮箱"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    {mode === "password" && (
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        placeholder="密码"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    )}
                    <button type="submit" disabled={busy}>
                      {mode === "password" ? "登录"
                        : mode === "link" ? "发送登录链接"
                        : "发送重置链接"}
                    </button>
                  </form>

                  {/* 备用路径收在一行文字链接里。它们是"进不去的时候"才用的，
                      不该和默认路径长得一样大——否则每次登录都要先做一次选择。 */}
                  <p style={{ margin: "8px 0 0", color: "var(--muted)", display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {mode !== "password" && (
                      <LinkBtn onClick={() => { setMode("password"); say(""); }}>用密码登录</LinkBtn>
                    )}
                    {mode !== "link" && (
                      <LinkBtn onClick={() => { setMode("link"); say(""); }}>没有密码 · 用邮件链接</LinkBtn>
                    )}
                    {mode !== "reset" && (
                      <LinkBtn onClick={() => { setMode("reset"); say(""); }}>忘了密码</LinkBtn>
                    )}
                  </p>
                </>
              )}

              {msg && (
                <p style={{ margin: "8px 0 0", lineHeight: 1.6, color: msgBad ? "var(--stop)" : "var(--muted)" }}>
                  {msg}
                </p>
              )}
            </>
          ) : (
            <p style={{ color: "var(--muted)" }}>云端同步未配置（缺 Supabase 环境变量）。</p>
          )}
        </div>
      )}
    </div>
  );
}

/** 文字按钮。用 button 而不是 <a href="#">：它不导航，只切换模式——
 *  用 a 会在地址栏留一个 # 并且键盘语义也不对。 */
function LinkBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "none",
        border: 0,
        padding: 0,
        font: "inherit",
        color: "var(--ink2)",
        textDecoration: "underline",
        textUnderlineOffset: 2,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
