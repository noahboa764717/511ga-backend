const express = require('express');
const axios = require('axios');
const cors = require('cors');

const app = express();

// Enable CORS so your GitHub Pages domain can stream from this proxy
app.use(cors());

const CAMERA_ID = 'PICK-CCTV-0020';
const BASE_STREAM_URL = `https://sfs-msc-pub-lq-02.navigator.dot.ga.gov/rtplive/${CAMERA_ID}/playlist.m3u8`;

async function getFreshPlaylist() {
  const cctvPage = await axios.get('https://511ga.org/map/Cctv/19637', {
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });

  const tokenMatch = cctvPage.data.match(/token=([a-zA-Z0-9\._\-]+)/);
  if (!tokenMatch) throw new Error('Token not found');

  const freshToken = tokenMatch[1];
  const streamWithToken = `${BASE_STREAM_URL}?token=${freshToken}`;

  const playlistResponse = await axios.get(streamWithToken);
  let manifest = playlistResponse.data;

  // Append token to chunk segment URLs
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
    res.status(500).send('Error loading stream token.');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));