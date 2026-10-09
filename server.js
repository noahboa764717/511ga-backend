const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

// Helper function to obtain token from 511GA
async function fetchToken() {
  const customHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Referer': 'https://511ga.org/',
    'X-Requested-With': 'XMLHttpRequest'
  };

  // 1. Fetch 511GA CCTV detail panel html
  const response = await axios.post(
    'https://511ga.org/map/Cctv/19637',
    {},
    { headers: customHeaders, timeout: 10000 }
  ).catch(async () => {
    // Fallback to GET if POST is rejected
    return await axios.get('https://511ga.org/map/Cctv/19637', { headers: customHeaders, timeout: 10000 });
  });

  const htmlData = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

  // 2. Extract JWT token string
  const tokenMatch = htmlData.match(/token=([a-zA-Z0-9\._\-]+)/i) || 
                     htmlData.match(/eyJ[a-zA-Z0-9\._\-]+/);

  if (!tokenMatch) {
    throw new Error('JWT stream token not found in 511GA response.');
  }

  return tokenMatch[1] || tokenMatch[0];
}

// Stream proxy endpoint
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

    // Rewrite relative sub-playlist links (chunklist_...) to include token & absolute media path
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      const cleanFile = match.split('?')[0];
      return `${MEDIA_SERVER_BASE}/${cleanFile}?token=${token}`;
    });

    res.setHeader('Content-Type', 'application/x-mpegURL');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(manifest);
  } catch (error) {
    console.error('Proxy Stream Error:', error.message);
    res.status(500).send(`Error fetching stream: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA HLS Proxy Server Active');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy listening on port ${PORT}`));
