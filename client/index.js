const ws = require('ws');
const fs = require('fs');

const socket = new ws('ws://localhost:3000', { headers: { "Authorization": "SomeAccessToken", } });

socket.on('open', () => {
  socket.send(JSON.stringify({ type: 'IDENTIFY', payload: { device: 'ThisIsAName' } }));
});

let streams = {};

socket.on('message', (data) => {
  let message = Buffer.from(data).toString(), isJSON = false;
  if (message.slice(0,1) == '{' ) {
    try {
      message = JSON.parse(message);
      isJSON = true;
    } catch (e) {}
  };

  if (isJSON && message.type === 'PING') {
    return socket.send(JSON.stringify({ type: 'PONG' }));
  } else if (isJSON && message.type === 'DOWNLOAD') {
    console.log('Downloading file: %s', message.payload.filename);
    const fileStats = fs.statSync(message.payload.filename);
    const totalChunks = Math.floor(fileStats.size/ 1024 / 1024 / 10);
    const file = fs.createReadStream(message.payload.filename, { highWaterMark: 1024*1024*10 });

    streams[message.payload.filename] = file;

    file.on('error', (err) => {
      socket.send(JSON.stringify({ type: 'DOWNLOAD', payload: { filename: message.payload.filename, error: err.message } }));
    });

    let chunkId = 0;
    file.on('data', (chunk) => {
      file.pause();
      console.log(`Sending chunk ${chunkId}/${totalChunks}`);
      socket.send(JSON.stringify({ type: 'DOWNLOAD', payload: { filename: message.payload.filename, data: chunk.toString('base64'), chunkId } }));
      chunkId++;
    });

    file.on('end', () => {
      socket.send(JSON.stringify({ type: 'DOWNLOAD', payload: { filename: message.payload.filename, finish: true } }));
    });

    return;
  } else if (isJSON && message.type === 'UPLOAD') {
    if (!streams[message.payload.filename]) return;
    streams[message.payload.filename].resume();
    return;
  }

  console.log('Received: %s', data);
});

socket.on('close', () => {
  Object.entries(streams).forEach(([filename, file]) => {
    file.pause();
    file.close();
  });
  console.log('Connection closed');
});