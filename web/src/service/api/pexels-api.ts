import axios from 'axios';

export type PexelsOrientation = '' | 'landscape' | 'portrait' | 'square';

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  avg_color: string;
  alt: string;
  src: { original: string; large: string; large2x: string; medium: string };
}

interface PexelsPage {
  photos: PexelsPhoto[];
  page: number;
  total_results?: number;
  next_page?: string;
}

// 独立 client，避免携带应用 JWT，也不触发应用的登录恢复流程。
const client = axios.create({ baseURL: 'https://api.pexels.com/v1', timeout: 15000 });

export async function getPexelsPhotos(
  filters: { query: string; orientation: PexelsOrientation; color: string; page: number },
  signal: AbortSignal
): Promise<PexelsPage> {
  const key = import.meta.env.VITE_PEXELS_API_KEY?.trim();
  if (!key) throw new Error('图库暂未配置，请联系管理员');
  const query = filters.query.trim() || (filters.orientation || filters.color ? '自然' : '');
  try {
    const { data } = await client.get<PexelsPage>(query ? '/search' : '/curated', {
      headers: { Authorization: key },
      signal,
      params: {
        page: filters.page,
        per_page: 30,
        ...(query && {
          query,
          locale: 'zh-CN',
          orientation: filters.orientation || undefined,
          color: filters.color || undefined,
        }),
      },
    });
    return data;
  } catch (cause) {
    // AxiosError.config 含 Authorization；只保留不含凭据的原因供诊断。
    if (axios.isAxiosError(cause)) {
      cause.config = undefined;
      cause.request = undefined;
      cause.response = cause.response
        ? { ...cause.response, config: { headers: new axios.AxiosHeaders() }, request: undefined }
        : undefined;
    }
    if (signal.aborted) throw new Error('请求已取消', { cause });
    const status = axios.isAxiosError(cause) ? cause.response?.status : undefined;
    if (status === 401 || status === 403)
      throw new Error('图库授权失败，请联系管理员检查配置', { cause });
    if (status === 429) throw new Error('图库请求次数已达上限，请稍后再试', { cause });
    throw new Error('图库加载失败，请检查网络后重试', { cause });
  }
}
