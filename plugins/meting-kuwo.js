const axios = require('axios');

const BASE_URL = 'https://api.i-meto.com/meting/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function formatDuration(raw) {
  if (!raw) return 0;
  if (typeof raw === 'number') return raw;
  const parts = String(raw).split(':');
  if (parts.length === 2) return Number(parts[0]) * 60 + Number(parts[1]);
  if (parts.length === 3) return Number(parts[0]) * 3600 + Number(parts[1]) * 60 + Number(parts[2]);
  return Number(raw) || 0;
}

module.exports = {
  platform: '酷我音乐',
  version: '1.0.0',
  author: 'Meting',
  supportedSearchType: ['music'],
  primaryKey: ['id'],
  srcUrl: 'https://api.i-meto.com/meting/api',

  async search(query, page, type) {
    const { data } = await axios.get(BASE_URL, {
      params: { server: 'kuwo', type: 'search', id: query },
      headers: { 'User-Agent': UA },
      timeout: 15000,
    });
    const list = Array.isArray(data) ? data.filter(item => item && item.title) : [];
    return {
      isEnd: true,
      data: list.map(item => ({
        id: String(item.url_id || item.id || Math.random()),
        platform: '酷我音乐',
        title: item.title || '',
        artist: item.author || '',
        album: item.album || '',
        artwork: item.pic || '',
        url: item.url || '',
        lrc: item.lrc || '',
        duration: formatDuration(item.time),
        _raw: item,
      })),
    };
  },

  async getMediaSource(musicItem, quality) {
    if (musicItem.url) {
      return { url: musicItem.url, userAgent: UA };
    }
    const raw = musicItem._raw;
    if (raw && raw.url) {
      return { url: raw.url, userAgent: UA };
    }
    return null;
  },

  async getLyric(musicItem) {
    const lrcUrl = musicItem.lrc || musicItem._raw?.lrc;
    if (!lrcUrl) return null;
    try {
      const { data } = await axios.get(lrcUrl, { timeout: 10000 });
      return { rawLrc: typeof data === 'string' ? data : JSON.stringify(data) };
    } catch (e) {
      return null;
    }
  },
};
