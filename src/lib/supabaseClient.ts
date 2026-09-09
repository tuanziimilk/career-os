// Supabase 客户端。anon key 设计上就是给前端用的——权限完全由数据库的
// RLS 策略决定（见 supabase/schema.sql），不是"key 泄露了就完了"。
//
// URL 和 anon key 通过环境变量注入，不硬编在源码里，
// 这样公开仓库里看不到你的项目引用，且以后换项目/多环境时改 .env 就行。
import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = supabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null;
