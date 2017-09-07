/* start server and socket.io */
const fs = require('fs');

const sslPath = '/etc/letsencrypt/live/circles.antoniasiu.co.uk';
const options = {
  key: fs.readFileSync(sslPath + '/privkey.pem').toString(),
  cert: fs.readFileSync(sslPath + '/fullchain.pem').toString(),
};

const https = require('https');
const httpsServer = https.createServer(options);
const io = require('socket.io').listen(httpsServer);
httpsServer.listen(3000, () => console.log('https running on port 3000'));

/* constants */

const tickLength = 20;
const gameLengthInTicks = 1500;

const maxSpeed = 20;
const accel = 1;
const ballRadius = 20;

/* map functions */

function getInnerRadius(currentTickTime) {
  return (gameLengthInTicks - currentTickTime) * 2 / 3;
}

function getOuterRadius(currentTickTime) {
  return getInnerRadius(currentTickTime) + getInnerRadius(0);
}

// grid is centred about (0,0)
const gridSize = getOuterRadius(0);


/* ticker – simulates each game frame */
let running = false;
let simulator;
let tickTime = 0;

function startTickingIfStopped() {
  if (running) return;
  running = true;
  tickTime = 0;
  console.log('info : ticker started');
  // update function moves all circles for each tick
  simulator = setInterval(update, tickLength);
}

function stopTicking() {
  running = false;
  clearInterval(simulator);
  console.log('info : ticker stopped');
}

/* game objects */
let players = [];
let powerups = [];

io.on('connection', (socket) => {
  console.log(`conn : (${socket.id}) player connection`);
  let player = null;
  socket.on('playerInfo', (nickname) => {
    // generate player and add to list
    const id = socket.id;
    if (havePlayerID(id)) {
      socket.disconnect();
      deletePlayer(id);
      return;
    }
    nickname = validateNickname(nickname);
    console.log(`conn : (${id}) "${nickname}" connected`);
    player = {
      id: id,
      socket: socket,
      nickname: nickname,
      pos: getFreePosition(),
      vel: {
        x: 0,
        y: 0,
      },
      keys: {
        left: false,
        up: false,
        right: false,
        down: false,
      },
      powers: {
        maxspeed: 1,
        weight: 1,
        accel: 1
      },
      inGame: false,
      score: 0
    };
    players.push(player);
    startTickingIfStopped();
  });

  socket.on('disconnect', () => {
    if (player === null) return;
    deletePlayer(player.id);
    console.log(`disc : (${player.id}) "${player.nickname}" disconnected`);
    if (players.length === 0) stopTicking();
  });

  socket.on('keyUpdate', (keys) => {
    if (player === null) socket.disconnect();
    else player.keys = keys;
  });
});

function update() {
  tickTime += 1;
  // if time is up restart game
  if (tickTime === gameLengthInTicks) {
    tickTime = 0;
    players.forEach((player) => {
      // bring all players back into play
      player.inGame = true;
      // reset all player powers
      player.powers = {
        maxspeed: 1,
        weight: 1,
        accel: 1
      };
    });
  }
  players.forEach((player) => {
    movePlayer(player);
  });
  bounceOffWalls(); // will also change scores
  handleCollisions();
  handlePowerups();
  sendDataToClients();
}

function movePlayer(player) {
  const naccel = accel * player.powers.accel;
  if (player.keys.left) player.vel.x -= naccel;
  if (player.keys.up) player.vel.y -= naccel;
  if (player.keys.down) player.vel.y += naccel;
  if (player.keys.right) player.vel.x += naccel;
  player.vel.x *= 0.997;
  player.vel.y *= 0.997;
  let nmaxspeed = maxSpeed * player.powers.maxspeed;
  if (player.vel.x > nmaxspeed) player.vel.x = nmaxspeed;
  if (player.vel.x < -nmaxspeed) player.vel.x = -nmaxspeed;
  if (player.vel.y > nmaxspeed) player.vel.y = nmaxspeed;
  if (player.vel.y < -nmaxspeed) player.vel.y = -nmaxspeed;
  player.pos.x += player.vel.x;
  player.pos.y += player.vel.y;
}

function bounceOffWalls() {
  const innerR2 = sq(getInnerRadius(tickTime) + ballRadius);
  const outerR2 = sq(getOuterRadius(tickTime) + ballRadius);
  let playersInside = 0;
  players.forEach((p) => {
    if (p.inGame) playersInside += 1;
  });
  let playersFallenOutside = 0;
  players.forEach((p) => {
    const centreDistance2 = sq(p.pos.x) + sq(p.pos.y);
    if (p.inGame && centreDistance2 > innerR2) {
      // player has fallen outside circle
      p.inGame = false;
      // lose a point for every player still inside
      p.score = Math.max(0, p.score - playersInside);
      playersFallenOutside += 1;
    }
    if (!p.inGame) {
      if (outerR2 > centreDistance2) {
        //p.socket.disconnect();
        console.log(`perr : (${p.id}) "${p.nickname}" out of bounds`);
      } else if (innerR2 < centreDistance2) {
        // if trying to get back inside
        // bounce off a 'ball' in the centre
        // which has the same effect as bouncing off the grid
        bounceBalls(p, {
          pos: {
            x: 0,
            y: 0
          },
          vel: {
            x: 0,
            y: 0
          }
        });
      }
    }
  });
  players.forEach((p) => {
    if (p.inGame) p.score += playersFallenOutside;
  });
}

function handleCollisions() {
  // sort by x coord for collision detection
  // (at worst mostly) sorted list
  players.sort((p1, p2) => p1.pos.x - p2.pos.x);
  // check each player only by players after it in the list
  for (let x = 0; x < players.length - 1; x++) {
    let p1 = players[x];
    // x limit is the farthest away following balls can be and still touch
    let xlimit = p1.pos.x + ballRadius * 2;
    // only compare following balls with pos.x < xlimit
    for (let y = x + 1; y < players.length && players[y].pos.x <= xlimit; y++)
      if (touchingBalls(p1, players[y])) bounceBalls(p1, players[y]);
  }
}

function touchingBalls(p1, p2) {
  // algorithm assumes x coordinates are in range
  const r = ballRadius;
  if (p1.pos.y + r < p2.pos.y - r || p1.pos.y - r > p2.pos.y + r) return false;
  else return sq(p2.pos.x - p1.pos.x) + sq(p2.pos.y - p1.pos.y) < sq(r + r);
}

function bounceBalls(p1, p2) {
  const xDist = p1.pos.x - p2.pos.x,
    yDist = p1.pos.y - p2.pos.y,
    distSq = sq(xDist) + sq(yDist),
    xVel = p2.vel.x - p1.vel.x,
    yVel = p2.vel.y - p1.vel.y,
    dotProduct = xDist * xVel + yDist + yVel;
  // if dotProduct <= 0, balls aren't heading in the same direction
  if (dotProduct <= 0) return;
  const collisionScale = dotProduct / distSq,
    xCol = xDist * collisionScale,
    yCol = yDist * collisionScale,
    massTotal = p1.powers.weight + p2.powers.weight,
    weight1 = 2 * p2.powers.weight / massTotal,
    weight2 = 2 * p1.powers.weight / massTotal;
  // change player velocities
  p1.vel.x = xCol * weight1;
  p1.vel.y = yCol * weight1;
  p2.vel.x = -xCol * weight2;
  p2.vel.y = -yCol * weight2;
}

function handlePowerups() {
  // TODO use sorted list to make this a bit less O(n^2) time
  players.forEach((player) => {
    powerups.forEach((powerup) => {
      // check if player is touching powerup
      if (player.pos.x - ballRadius > powerup.pos.x) return;
      if (player.pos.x + ballRadius < powerup.pos.y) return;
      if (player.pos.y - ballRadius > powerup.pos.x) return;
      if (player.pos.y + ballRadius < powerup.pos.y) return;
      const trueDist2 = Math.abs(sq(player.pos.x - powerup.pos.x) +
        sq(player.pos.y - powerup.pos.y));
      if (trueDist2 < sq(ballRadius)) {
        // if so apply and delete the powerup
        deletePowerup(powerup);
        switch (powerup.type) {
          case 0:
            player.powers.maxspeed = 1.2;
            break;
          case 1:
            player.powers.maxspeed = 0.8;
            break;
          case 2:
            player.powers.weight = 1.5;
            break;
          case 3:
            player.powers.weight = 0.7;
            break;
          case 4:
            player.powers.accel = 1.5;
            break;
          case 5:
            player.powers.weight = 0.7;
        }
      }
    });
  });
  // place a new powerup with some probability
  const probability = players.length / gameLengthInTicks;
  if (Math.random() < probability) powerups.push({
    pos: {
      x: Math.random * gridSize * 0.35 - gridSize * 0.35 / 2,
      y: Math.random * gridSize * 0.35 - gridSize * 0.35 / 2
    },
    /* maxspeed: +:0, -:1
       weight:   +:2, -:3
       accel:    +:4, -:5
    */
    type: Math.floor(Math.random * 6)
  });
}

function sendDataToClients() {
  const playersInfo = [];
  players.forEach((player) => {
    playersInfo.push({
      pos: player.pos,
      nickname: player.nickname,
      id: player.id,
      score: player.score
    });
  });
  io.emit('mapUpdate', playersInfo, powerups, tickTime);
}

function getFreePosition() {
  const range = gridSize * 0.35,
    lb = -range / 2;
  let tx, ty, lx, ly, ux, uy, freeSpace;
  let attempts = 100;
  while (attempts-- > 0) {
    freeSpace = true;
    tx = Math.random() * range + lb;
    ty = Math.random() * range + lb;
    lx = tx - ballRadius;
    ly = ty - ballRadius;
    ux = tx + ballRadius;
    uy = ty + ballRadius;
    for (let x = 0; x < players.length; x++) {
      const p = players[x];
      if (p.x > lx && p.x < ux && p.y > ly && p.y < uy) {
        freeSpace = false;
        break;
      }
    }
    if (freeSpace) return {
      x: tx,
      y: ty
    };
  }
  return {
    x: 0,
    y: 0
  };
}

function sq(x) {
  return x * x;
}

function havePlayerID(id) {
  for (let x = 0; x < players.length; x++)
    if (players[x].id === id) return true;
  return false;
}

function deletePowerup(powerup) {
  // powerups are identified by their grid position
  // no need to consider two powerups with the same position
  // as both would be picked up in the same tick by one player
  powerups = powerups.filter(p => p.pos !== powerup.pos);
}

function deletePlayer(id) {
  players = players.filter(p => p.id !== id);
}

function validateNickname(n) {
  return (n === undefined || n === '') ? 'player' : n.substring(0, 12);
}
