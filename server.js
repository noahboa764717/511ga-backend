const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const BASE_STREAM_URL = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}/playlist.m3u8`;

async function getFreshPlaylist() {
  // Pass full browser headers to avoid being blocked by Cloudflare/GDOT
  const cctvPage = await axios.get('https://511ga.org/map/Cctv/19637', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
      'Referer': 'https://511ga.org/'
    },
    timeout: 8000
  });

  // Broader regex to catch JWT token patterns (eyJ...) or token query parameters
  const tokenMatch = cctvPage.data.match(/token=([a-zA-Z0-9\._\-]+)/) || 
                     cctvPage.data.match(/eyJ[a-zA-Z0-9\._\-]+/);

  if (!tokenMatch) {
    console.error('HTML Response snippet:', cctvPage.data.substring(0, 500));
    throw new Error('Token string not found in 511GA response.');
  }

  // Extract matched token
  const freshToken = tokenMatch[1] || tokenMatch[0];
  const streamWithToken = `${BASE_STREAM_URL}?token=${freshToken}`;

  const playlistResponse = await axios.get(streamWithToken, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    }
  });

  let manifest = playlistResponse.data;

  // Append token to all segment lines
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
    console.error('Proxy Error Details:', error.message);
    res.status(500).send(`Error loading stream token: ${error.message}`);
  }
});

app.get('/', (req, res) => {
  res.send('511GA Proxy Server is active. Request /stream.m3u8 for playlist.');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
