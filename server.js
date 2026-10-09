const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const MEDIA_SERVER_BASE = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}`;

// Set your active session cookie or API key here:
const SESSION_COOKIE = 'PASTE_YOUR_ACTIVE_COOKIE_HERE';

async function fetchToken() {
  const pageRes = await axios.get('https://511ga.org/map/Cctv/19637', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Cookie': SESSION_COOKIE,
      'Referer': 'https://511ga.org/'
    }
  });

  const tokenMatch = pageRes.data.match(/token=([a-zA-Z0-9\._\-]+)/) || 
                     pageRes.data.match(/eyJ[a-zA-Z0-9\._\-]+/);

  if (!tokenMatch) throw new Error('Token not found in response');
  return tokenMatch[1] || tokenMatch[0];
}

// Master Playlist Proxy Endpoint
app.get('/stream.m3u8', async (req, res) => {
  try {
    const token = await fetchToken();
    const masterUrl = `${MEDIA_SERVER_BASE}/playlist.m3u8?token=${token}`;
    
    const response = await axios.get(masterUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    let manifest = response.data;

    // Rewrite relative sub-playlists (e.g. chunklist_w996507320.m3u8) to route through proxy
    manifest = manifest.replace(/^(chunklist_[^\s]+\.m3u8.*)$/gm, (match) => {
      // Strips old token from string and appends current dynamic token
      const cleanFile = match.split('?')[0];
      return `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}/${cleanFile}?token=${token}`;
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
