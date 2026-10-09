const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const NUMERIC_CAM_ID = '19637';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

// Helper: Fetch fresh JWT stream token directly from 511GA's JSON API
async function fetchToken() {
  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': `https://511ga.org/map/Cctv/${NUMERIC_CAM_ID}`,
    'X-Requested-With': 'XMLHttpRequest'
  };

  // Query 511GA's internal CCTV detail endpoint
  const apiRes = await axios.get(`https://511ga.org/api/v2/get/cctv/${NUMERIC_CAM_ID}`, {
    headers: customHeaders,
    timeout: 8000
  });

  const data = apiRes.data;
  
  // Extract token string from API JSON response
  let token = data.Token || data.token || data.otp || (data.Views && data.Views[0] ? data.Views[0].Token : null);

  // Fallback: Check if token is embedded in a StreamUrl string within JSON
  if (!token && data.StreamUrl) {
    const tokenMatch = data.StreamUrl.match(/token=([a-zA-Z0-9\._\-]+)/);
    if (tokenMatch) token = tokenMatch[1];
  }

  if (!token) {
    console.error('API Response Payload:', JSON.stringify(data));
    throw new Error('Token missing from 511GA CCTV API payload.');
  }

  return token;
}

// Master Playlist Endpoint
app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await fetchToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;

    const response = await axios.get(masterUrl, {
      headers: { 
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://511ga.org/'
      }
    });

    let manifest = response.data;

    // Rewrite relative sub-playlists to point directly to GDOT media server with the dynamic token
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Master Playlist Proxy Error:', error.message);
    res.status(500).send(`Error fetching stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA HLS Proxy Server Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
