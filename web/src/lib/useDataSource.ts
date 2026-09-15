// 数据源选择逻辑：三选一，优先级 supabase(已登录) > local(已连) > demo。
// 这是可插拔架构的落地——切换数据源不需要改任何页面组件。
import { useEffect, useState } from "react";
import type { DataSource } from "./types";
import { demoSource } from "./demoData";
import { localSource, isLocalConnected } from "./localSource";
import { supabaseSource, supabaseConfigured } from "./supabaseSource";
import { supabase } from "./supabaseClient";

export function useDataSource() {
  const [source, setSource] = useState<DataSource>(demoSource);
  const [loading, setLoading] = useState(true);

  async function resolve() {
    setLoading(true);
    if (supabaseConfigured && supabase) {
      const { data } = await supabase.auth.getUser();
      if (data.user) {
        setSource(supabaseSource);
        setLoading(false);
        return;
      }
    }
    if (await isLocalConnected()) {
      setSource(localSource);
      setLoading(false);
      return;
    }
    setSource(demoSource);
    setLoading(false);
  }

  useEffect(() => {
    resolve();
    // Supabase 登录状态变化时（登录/登出）重新判定数据源
    const sub = supabase?.auth.onAuthStateChange(() => resolve());
    return () => sub?.data.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { source, loading, refresh: resolve };
}
