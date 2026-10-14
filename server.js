const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const VIEW_ID = '19637';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

let cachedToken = null;
let tokenExpiry = 0;

// Automatically fetch a fresh token using backend session cookies
async function getAutomatedToken() {
  const now = Date.now();
  // Return cached token if it's still valid (tokens last ~2 mins, we refresh every 90 seconds)
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  try {
    // 1. Initialize session by hitting 511ga.org to capture ASP.NET cookies
    const homeRes = await axios.get('https://511ga.org/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 8000
    });

    const setCookieHeaders = homeRes.headers['set-cookie'];
    let cookieString = '';
    if (setCookieHeaders) {
      cookieString = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
    }

    // 2. Call GetVideoUrl with the active session cookies
    const videoRes = await axios.get(`https://511ga.org/GetVideoUrl?imageId=${VIEW_ID}&_=${Date.now()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieString,
        'Referer': `https://511ga.org/map/Cctv/${VIEW_ID}`,
        'X-Requested-With': 'XMLHttpRequest'
      },
      timeout: 8000
    });

    const dataStr = typeof videoRes.data === 'string' ? videoRes.data : JSON.stringify(videoRes.data);
    const tokenMatch = dataStr.match(/token=([a-zA-Z0-9\._\-]+)/) || dataStr.match(/(eyJ[a-zA-Z0-9\._\-]+)/);

    if (!tokenMatch) {
      throw new Error('Automated token pattern match failed.');
    }

    cachedToken = tokenMatch[1] || tokenMatch[0];
    tokenExpiry = now + 90000; // Refresh every 90 seconds automatically
    console.log('Successfully refreshed background stream token.');
    return cachedToken;
  } catch (error) {
    console.error('Background Token Fetch Error:', error.message);
    if (cachedToken) return cachedToken; // Fallback to old token if network hiccup occurs
    throw error;
  }
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await getAutomatedToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const response = await axios.get(masterUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://511ga.org/' }
    });

    let manifest = response.data;

    // Rewrite sub-playlist paths to route securely through your proxy
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error fetching stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Fully Automated Stream Proxy Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
