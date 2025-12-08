// src/demo-test.js
import express from 'express';
import path from 'path';

const app = express();
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Папка с демо
const demoDir = path.join(__dirname, '..', 'demo');
console.log('DEMO DIR TEST =', demoDir);

// Раздаём только демо
app.use('/demo', express.static(demoDir));

app.use((req, res) => {
  res.status(404).send(`404 demo-test: ${req.originalUrl}`);
});

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Demo-test server on http://localhost:${PORT}`);
});
