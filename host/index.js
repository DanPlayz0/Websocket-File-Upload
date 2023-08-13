// Raw Websocket Webserver
const express = require('express');
const app = express();
const WebSocket = require('ws');
const fs = require('fs');

const server = app.listen(3000);
const wss = new WebSocket.Server({ noServer: true });

app.get('/', (req, res) => {
  if (req.query.filename == null) return res.send('No filename specified');
  for (let client of wss.clients) {
    if (client.identified == false) continue;
    client.send(JSON.stringify({ type: 'DOWNLOAD', payload: { filename: req.query.filename } }));
    return res.send('File requested');
  }

});

// Heartbeat
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    if (ws.connectedAt && ws.identified === false && (Date.now() - ws.connectedAt) > 30_000) return ws.terminate();
    ws.isAlive = false;
    ws.send(JSON.stringify({ type: 'PING' }));
  });
}, 30_000);


// Socket Authentication
server.on('upgrade', (req, socket, head) => {
  if (req.headers['authorization'] !== 'SomeAccessToken') {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
})

wss.on('connection', (ws) => {
  console.log('Client connected');
  ws.connectedAt = Date.now();
  ws.identified = false;

  const files = {};

  ws.on('message', (raw) => {
    let message = Buffer.from(raw).toString(), isJSON = false;
    if (message.slice(0,1) == '{' ) {
      try {
        message = JSON.parse(message);
        isJSON = true;
      } catch (e) {}
    }

    if (isJSON) {
      if (message.type === 'IDENTIFY') {
        message.payload.device = message.payload.device || 'Unknown';
        if (message.payload.device === 'Unknown') {
          ws.send(JSON.stringify({ type: 'ERROR', payload: { message: "Invalid payload." } }));
          return;
        }

        ws.identified = true;
        ws.device = message.payload.device;
        console.log(`Client identified as ${ws.device}`);
        return;
      } else if (message.type === "PONG") {
        ws.isAlive = true;
        return;
      } else if (message.type === "DOWNLOAD") {
        if (ws.identified == false) {
          ws.send(JSON.stringify({ type: 'ERROR', payload: { message: "You need to identify first." } }));
          return;
        }

        if (message.payload.filename == null) {
          ws.send(JSON.stringify({ type: 'ERROR', payload: { message: "No filename specified" } }));
          return;
        }

        if (!files.hasOwnProperty(message.payload.filename)) files[message.payload.filename] = fs.createWriteStream(require('path').join(__dirname, message.payload.filename));
        const file = files[message.payload.filename];

        if (message.payload.finish === true) {
          file.end();
          delete files[message.payload.filename];
          ws.send(JSON.stringify({ type: 'SUCCESS', payload: { message: "File downloaded" } }));
          return;
        } else if (message.payload.error != null) {
          file.end();
          fs.unlinkSync(require('path').join(__dirname, message.payload.filename));
          delete files[message.payload.filename];
          return;
        }

        console.log(`Recieved chunk ${message.payload.chunkId} for ${message.payload.filename}`);
        ws.send(JSON.stringify({ type: 'UPLOAD', payload: { filename: message.payload.filename } }));
        file.write(Buffer.from(message.payload.data, 'base64'));
      }
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  })
});