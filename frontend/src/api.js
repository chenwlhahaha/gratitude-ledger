const TOKEN_KEY = "hx_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY) || "";
export const setToken = t => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export async function api(path, body, opts = {}) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + getToken() },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && !opts.silent) { clearToken(); location.reload(); throw new Error(j.error || "请重新登录"); }
  if (!r.ok) throw Object.assign(new Error(j.error || "操作失败"), { status: r.status });
  return j;
}
export const fmt = n => Math.round(n || 0).toLocaleString("zh-CN");
