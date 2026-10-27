export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
 const res = await fetch('/api' + path, {...options, headers: {'Content-Type':'application/json', ...options.headers}});
 const data = await res.json(); if (!res.ok) throw new Error(data.error || 'Request failed'); return data;
}
export const money = (n:number) => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
