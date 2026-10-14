const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const API_KEY = '3ca9a6a23e314e9fb043dcc8f5db3829';
const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const CAMERA_INTERNAL_ID = 19637;
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

// Token caching to respect 511GA rate limits (10 calls per 60 seconds)
let cachedToken = null;
let tokenExpiry = 0;

async function getValidToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  try {
    const response = await axios.get(`https://511ga.org/api/v2/get/cameras?key=${API_KEY}&format=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const cameras = Array.isArray(response.data) ? response.data : (response.data.Cameras || response.data.data || []);
    const cam = cameras.find(c => c.SourceId === CAMERA_SOURCE_ID || c.Id === CAMERA_INTERNAL_ID);

    if (!cam) {
      throw new Error('Camera not found in API response.');
    }

    let token = null;
    if (cam.Views) {
      for (const view of cam.Views) {
        const str = view.Url || view.Token || view.StreamUrl || JSON.stringify(view);
        const match = str.match(/token=([a-zA-Z0-9\._\-]+)/) || str.match(/(eyJ[a-zA-Z0-9\._\-]+)/);
        if (match) {
          token = match[1] || match[0];
          break;
        }
      }
    }

    if (!token && cam.StreamUrl) {
      const match = cam.StreamUrl.match(/token=([a-zA-Z0-9\._\-]+)/);
      if (match) token = match[1];
    }

    if (!token) {
      throw new Error('Token could not be parsed from camera object.');
    }

    cachedToken = token;
    tokenExpiry = now + 45000; // Cache valid for 45 seconds
    return cachedToken;
  } catch (error) {
    console.error('API Error:', error.message);
    if (cachedToken) return cachedToken; // Fallback to cached token if throttled
    throw error;
  }
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await getValidToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const response = await axios.get(masterUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://511ga.org/' }
    });

    let manifest = response.data;

    // Rewrite sub-playlist paths to route through proxy with active token
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
  res.send('511GA API-Authenticated Proxy Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
