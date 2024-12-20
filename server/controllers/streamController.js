const Group = require('../models/Group');
const Light = require('../models/Light');
const hueStream = require('../singleton/hueStream');
const utilities = require('../services/utilities');

const axios = require('axios');
const {
  dtls
} = require("node-dtls-client");

// connect
exports.connect = connectSocket;

// addQueue
exports.addQueue = addToQueue;

exports.addQueueTest = addToQueueTest;
// playNext
exports.playNext = playNextEffect;

async function connectSocket(groupId) {
  const group = Group.find(groupId, true);
  await group.activateStreaming();
  hueStream.setGroup(group)
  await hueStream.syncLights();
  hueStream.setSocket(await openSocket(socketOptions(group)));
  return true;
}

async function addToQueue(lightData) {
  return await hueStream.addToQueue(lightData)
}

async function addToQueueTest() {
  const lightData = {
    duration: 2000,
    interval: 50,
    effect: hueStream.lights.map(light => [{
      start: 0, end: 900, colors: [["start", "start", 255]], formula: 't'
    },
      {
        start: 900, colors: [["start", "start", 50]]
      },
      {
        start: 1600, end: 2000, colors: [["start", "start", "start"]], formula: 't'
      },
    ]),
  }
  return await addToQueue(lightData)
}

async function playNextEffect() {
  if (!await hueStream.playNext()) throw new Error('queue empty')
  return true;
}

function socketOptions(group) {
  return {
    type: "udp4",
    address: group.bridge.ip,
    port: 2100,
    psk: {
      "hue-application-id": Buffer.from(group.bridge.clientkey, 'hex') // Key should be binary (not a hex string)
    },
    timeout: 2000,
    ciphers: ["TLS_PSK_WITH_AES_128_GCM_SHA256"],
  };
}




// start streaming


async function openSocket(options, retryIndex = 0, maxRetry = 3) {
  if (retryIndex >= maxRetry) throw new Error(`Failed opening socket after ${retryIndex++} tries`, 569)
  const socket = dtls.createSocket(options);

  return new Promise((resolve, reject) => {
    // Listen for the 'connected' event
    socket.on("connected", () => {
      console.log('connected to hue stream');
      closeStreamOnExit();
      resolve(socket); // Resolve the Promise with the socket
    })
    .on("error", (e /* Error */) => {
      console.log(e);
      if (e.message == 'The DTLS handshake timed out') {
        retryIndex++
        console.log(`DTLS handshake error after ${retryIndex} of ${maxRetry} tries`)

        return resolve(openSocket(options, retryIndex));
      } else {
        closeSocket(socket);
        throw e;
      }
    })
    .on("message",
      (msg /* Buffer */) => {
        console.log({
          msg
        })
      })
    .on("close",
      () => {
        console.log("Stream closed")
      })
  });
}

function closeStreamOnExit(socket) {
  process.on('SIGINT', () => {
    console.log("\nCaught interrupt signal (Ctrl + C). Closing stream...");
    try {
      hueStream.removeActiveEffect();
      closeSocket(socket).then(response => {
        process.exit(0);
      }); // Gracefully close the DTLS stream
    } catch (error) {
      console.warn(error.message);
      setTimeout(() => process.exit(0),
        1000); // Give it time to close before forcing exit
    }

  });

  // Handle process termination (like kill command)
  process.on('SIGTERM', () => {
    console.log("\nCaught SIGTERM. Closing stream...");
    try {
      closeSocket(socket).then(response => {
        process.exit(0);
      }); // Gracefully close the DTLS stream
    } catch (error) {
      console.warn(error.message);
      setTimeout(() => process.exit(0),
        1000); // Give it time to close before forcing exit
    }
  });
}

async function closeSocket(socket) {
  if (socket) {
    try {
      await socket.close();
    } catch(err) {
      if (err.code !== "ERR_SOCKET_DGRAM_NOT_RUNNING") throw err;
    }
  }

  await hueStream.group.deactivateStreaming();
  return true;
}