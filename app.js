const express = require('express');
const app = express();
const PORT = 3000;

app.get('/', (req, res) => {
  res.send('Hello from the test app!');
});

app.get('/slow', async (req, res) => {
  // simulate a slow operation so you get an interesting trace
  await new Promise(resolve => setTimeout(resolve, 800));
  res.send('That took a while.');
});

app.get('/error', (req, res) => {
  res.status(500).send('Something went wrong!');
});

app.listen(PORT, () => {
  console.log(`Test app running on http://localhost:${PORT}`);
});