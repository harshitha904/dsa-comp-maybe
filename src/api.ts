export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
 let res: Response;
 try { res = await fetch('/api' + path, {...options, headers: {'Content-Type':'application/json', ...options.headers}}); }
 catch { throw new Error('Cannot reach the local API. Check that the server is running and retry.'); }
 const raw = await res.text();
 let data: any;
 try { data = JSON.parse(raw); } catch { throw new Error('The local API returned an incomplete response. Check the server and retry.'); }
 if (!res.ok) throw new Error(data.error || 'Request failed'); return data;
}
export const money = (n:number) => new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(n);
