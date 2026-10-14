const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const API_KEY = '3ca9a6a23e314e9fb043dcc8f5db3829';
const CAMERA_SOURCE_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_SOURCE_ID}`;

let cachedManifest = null;
let cacheExpiry = 0;

async function getStreamManifest() {
  const now = Date.now();
  if (cachedManifest && now < cacheExpiry) {
    return cachedManifest;
  }

  // Fetch the official camera metadata feed directly using your verified API key
  const response = await axios.get('https://511ga.org/api/v2/get/cameras', {
    params: { key: API_KEY, format: 'json' },
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });

  const cameras = Array.isArray(response.data) ? response.data : (response.data.Cameras || response.data.data || []);
  const cam = cameras.find(c => c.SourceId === CAMERA_SOURCE_ID || (c.Name && c.Name.includes(CAMERA_SOURCE_ID)));

  if (!cam) {
    throw new Error(`Camera ${CAMERA_SOURCE_ID} not found in API response.`);
  }

  // Extract token from the camera properties if present, or query the media server directly
  const camString = JSON.stringify(cam);
  const tokenMatch = camString.match(/token=([a-zA-Z0-9\._\-]+)/) || camString.match(/(eyJ[a-zA-Z0-9\._\-]+)/);
  
  let masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8`;
  if (tokenMatch) {
    const token = tokenMatch[1] || tokenMatch[0];
    masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;
  }

  const playlistResponse = await axios.get(masterUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://511ga.org/' }
  });

  cachedManifest = playlistResponse.data;
  cacheExpiry = now + 20000; // Cache for 20 seconds
  return cachedManifest;
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const manifest = await getStreamManifest();
    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error fetching stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Direct API Proxy Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
