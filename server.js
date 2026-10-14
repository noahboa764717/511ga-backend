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

  // Query 511GA camera endpoint with the official API key
  const response = await axios.get('https://511ga.org/api/v2/get/cameras', {
    params: {
      key: API_KEY,
      format: 'json'
    },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });

  const cameras = Array.isArray(response.data) ? response.data : (response.data.Cameras || response.data.data || []);
  const cam = cameras.find(c => c.SourceId === CAMERA_SOURCE_ID || (c.Name && c.Name.includes(CAMERA_SOURCE_ID)));

    if (!cam) {
    throw new Error(`Camera ${CAMERA_SOURCE_ID} not found in API response.`);
  }

  // Parse token pattern out of any properties inside the camera object
  const camString = JSON.stringify(cam);
  const tokenMatch = camString.match(/token=([a-zA-Z0-9\._\-]+)/) || camString.match(/(eyJ[a-zA-Z0-9\._\-]+)/);

  if (!tokenMatch) {
    // Fallback: If no inline token is in the JSON record, fetch a generic active token via public stream manifest
    const fallbackRes = await axios.get(`${MEDIA_SERVER_BASE}/playlist.m3u8`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://511ga.org/' },
      validateStatus: () => true
    });
    
    const fallbackMatch = fallbackRes.data.match(/token=([a-zA-Z0-9\._\-]+)/);
    if (fallbackMatch) {
      cachedToken = fallbackMatch[1];
      tokenExpiry = now + 45000;
      return cachedToken;
    }
    
    throw new Error('API Key authenticated, but stream token could not be isolated.');
  }

  cachedToken = tokenMatch[1] || tokenMatch[0];
  tokenExpiry = now + 45000; // Cache for 45 seconds
  return cachedToken;
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
