// src/server.js
// Bootstrap only. Вся логика Express живёт в app.js

import app from './app.js';

const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[tempasi] listening on http://0.0.0.0:${PORT}`);
});
