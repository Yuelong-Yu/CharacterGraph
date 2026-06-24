"use client";

/**
 * 客户端注册 Service Worker。
 * 仅 production 注册，dev 模式跳过避免缓存干扰。
 */
import { useEffect } from "react";

export function SWRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // ignore
    });
  }, []);
  return null;
}
