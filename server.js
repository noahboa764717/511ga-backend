const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const API_KEY = '3ca9a6a23e314e9fb043dcc8f5db3829';
const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

let cachedToken = null;
let tokenExpiry = 0;

async function getValidToken() {
  const now = Date.now();
  if (cachedToken && now < tokenExpiry) {
    return cachedToken;
  }

  try {
    // 1. Fetch cameras list using API key
    const response = await axios.get(`https://511ga.org/api/v2/get/cameras?key=${API_KEY}&format=json`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000
    });

    const cameras = Array.isArray(response.data) ? response.data : (response.data.Cameras || response.data.data || []);
    const cam = cameras.find(c => c.SourceId === CAMERA_SOURCE_ID || (c.Name && c.Name.includes(CAMERA_SOURCE_ID)));

    if (!cam) {
      throw new Error(`Camera ${CAMERA_SOURCE_ID} not found in API response.`);
    }

    // 2. Extract the internal View ID (e.g., 19637) from the Views array
    const viewId = cam.Views && cam.Views[0] ? cam.Views[0].Id : null;
    if (!viewId) {
      throw new Error('No view ID found for camera.');
    }

    // 3. Request token using the view ID
    const customHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Referer': `https://511ga.org/map/Cctv/${viewId}`,
      'X-Requested-With': 'XMLHttpRequest'
    };

    const tokenRes = await axios.get(`https://511ga.org/map/Cctv/${viewId}`, {
      headers: customHeaders,
      timeout: 8000
    });

    const pageText = typeof tokenRes.data === 'string' ? tokenRes.data : JSON.stringify(tokenRes.data);
    const tokenMatch = pageText.match(/token=([a-zA-Z0-9\._\-]+)/i) || pageText.match(/(eyJ[a-zA-Z0-9\._\-]+)/);

    if (!tokenMatch) {
      throw new Error('Could not parse token from CCTV page response.');
    }

    cachedToken = tokenMatch[1] || tokenMatch[0];
    tokenExpiry = now + 45000; // Cache for 45 seconds
    return cachedToken;
  } catch (error) {
    console.error('Token Generation Error:', error.message);
    if (cachedToken) return cachedToken;
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
