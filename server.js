const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const BASE_STREAM_URL = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}/playlist.m3u8`;

async function getFreshPlaylist() {
  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://511ga.org/cctv',
    'X-Requested-With': 'XMLHttpRequest'
  };

  let freshToken = '';

  // 1. Fetch token directly from 511GA's CCTV API endpoint
  try {
    const tokenResponse = await axios.get('https://511ga.org/api/v2/get/cameras', {
      headers: customHeaders,
      timeout: 8000
    });

    // Locate the specific camera entry
    const cameras = Array.isArray(tokenResponse.data) ? tokenResponse.data : (tokenResponse.data.data || []);
    const camData = cameras.find(c => c.SourceId === CAMERA_ID || c.Id === 19637 || (c.Name && c.Name.includes('PICK-CCTV-0020')));

    if (camData) {
      // Extract token or query parameter from camera object fields
      freshToken = camData.Token || camData.otp || (camData.Views && camData.Views[0] ? camData.Views[0].Token : '');
    }
  } catch (err) {
    console.warn('Direct API token fetch failed, attempting page fallback:', err.message);
  }

  // Fallback: If API payload layout differs, hit the page directly
  if (!freshToken) {
    const pageRes = await axios.get('https://511ga.org/map/Cctv/19637', { headers: customHeaders });
    const tokenMatch = pageRes.data.match(/(?:token|otp)=([a-zA-Z0-9\._\-]+)/i) || 
                       pageRes.data.match(/eyJ[a-zA-Z0-9\._\-]+/);
    
    if (!tokenMatch) {
      throw new Error('Could not resolve stream token from 511GA API or Page.');
    }
    freshToken = tokenMatch[1] || tokenMatch[0];
  }

  // 2. Request the HLS playlist with the resolved token
  const streamWithToken = `${BASE_STREAM_URL}?token=${freshToken}`;
  const playlistResponse = await axios.get(streamWithToken, { headers: customHeaders });
  
  let manifest = playlistResponse.data;

  // Rewrite segment URLs to maintain token validity
  manifest = manifest.replace(/(.+\.ts)/g, (segment) => `${segment}?token=${freshToken}`);

  return manifest;
}

app.get('/stream.m3u8', async (req, res) => {
  try {
    const manifest = await getFreshPlaylist();
    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Error:', error.message);
    res.status(500).send(`Error loading stream token: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Proxy Server is active. Request /stream.m3u8 for playlist.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
